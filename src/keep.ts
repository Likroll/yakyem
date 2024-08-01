import { ApplicationContext } from "@spt/context/ApplicationContext";
import { InraidController } from "@spt/controllers/InraidController";
import { PlayerScavGenerator } from "@spt/generators/PlayerScavGenerator";
import { HealthHelper } from "@spt/helpers/HealthHelper";
import { InRaidHelper } from "@spt/helpers/InRaidHelper";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { QuestHelper } from "@spt/helpers/QuestHelper";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { ISaveProgressRequestData } from "@spt/models/eft/inRaid/ISaveProgressRequestData";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { SaveServer } from "@spt/servers/SaveServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { InsuranceService } from "@spt/services/InsuranceService";
import { LocalisationService } from "@spt/services/LocalisationService";
import { MailSendService } from "@spt/services/MailSendService";
import { MatchBotDetailsCacheService } from "@spt/services/MatchBotDetailsCacheService";
import { PmcChatResponseService } from "@spt/services/PmcChatResponseService";
import { TraderServicesService } from "@spt/services/TraderServicesService";
import { RandomUtil } from "@spt/utils/RandomUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { inject, injectable } from "tsyringe";
import { KConfig } from "./KConfig";
import { PlayerRaidEndState } from "@spt/models/enums/PlayerRaidEndState";
import { Item } from "@spt/models/eft/common/tables/IItem";
import { EquipmentSlots } from "@spt/models/enums/EquipmentSlots";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { IEftStats } from "@spt/models/eft/common/tables/IBotBase";

@injectable()
export class KeepEquipment extends InraidController {
	private config: KConfig = require("../config/config");

	constructor(@inject("WinstonLogger") logger: ILogger,
		@inject("SaveServer") saveServer: SaveServer,
		@inject("TimeUtil") timeUtil: TimeUtil,
		@inject("DatabaseService") databaseService: DatabaseService,
		@inject("PmcChatResponseService") pmcChatResponseService: PmcChatResponseService,
		@inject("MatchBotDetailsCacheService") matchBotDetailsCacheService: MatchBotDetailsCacheService,
		@inject("QuestHelper") questHelper: QuestHelper,
		@inject("ItemHelper") itemHelper: ItemHelper,
		@inject("ProfileHelper") profileHelper: ProfileHelper,
		@inject("PlayerScavGenerator") playerScavGenerator: PlayerScavGenerator,
		@inject("HealthHelper") healthHelper: HealthHelper,
		@inject("TraderHelper") traderHelper: TraderHelper,
		@inject("TraderServicesService") traderServicesService: TraderServicesService,
		@inject("LocalisationService") localisationService: LocalisationService,
		@inject("InsuranceService") insuranceService: InsuranceService,
		@inject("InRaidHelper") inRaidHelper: InRaidHelper,
		@inject("ApplicationContext") applicationContext: ApplicationContext,
		@inject("ConfigServer") configServer: ConfigServer,
		@inject("MailSendService") mailSendService: MailSendService,
		@inject("RandomUtil") randomUtil: RandomUtil
	) {
		super(logger, saveServer, timeUtil, databaseService, pmcChatResponseService, matchBotDetailsCacheService, questHelper, itemHelper, profileHelper,
			playerScavGenerator, healthHelper, traderHelper, traderServicesService, localisationService, insuranceService, inRaidHelper, applicationContext,
			configServer, mailSendService, randomUtil);
	}

	/**
     * Handle updating player profile post-pmc raid
     * @param sessionID session id
     * @param postRaidData post-raid data
     */
	protected override savePmcProgress(sessionID: string, postRaidData: ISaveProgressRequestData): void {
		if (postRaidData.exit == PlayerRaidEndState.SURVIVED) {
			super.savePmcProgress(sessionID, postRaidData);
			return;
		}

		const currentProfile = this.saveServer.getProfile(sessionID);
		let pmcData: IPmcData = currentProfile.characters.pmc;

		currentProfile.inraid.character = "pmc";

		// Sets xp, skill fatigue, location status, encyclopedia, etc
		this.updateProfile(pmcData, postRaidData, sessionID);
		
		if (!this.config.retainFoundInRaidStatus) {
			postRaidData.profile = this.inRaidHelper.removeSpawnedInSessionPropertyFromItems(postRaidData.profile);
		}

		postRaidData.profile.Inventory.items = 
			this.itemHelper.replaceIDs(postRaidData.profile.Inventory.items, postRaidData.profile,  pmcData.InsuredItems, postRaidData.profile.Inventory.fastPanel);
		
		this.inRaidHelper.addStackCountToMoneyFromRaid(postRaidData.profile.Inventory.items);

		if (this.config.keepItemsFoundInRaid) {
			this.inRaidHelper.setInventory(sessionID, pmcData, postRaidData.profile);
		} else if (this.config.keepItemsInSecureContainer) {
			const securedContainer = this.getSecuredContainerAndChildren(postRaidData.profile.Inventory.items);

			if (securedContainer) {
				pmcData = this.profileHelper.removeSecureContainer(pmcData);
				pmcData.Inventory.items = pmcData.Inventory.items.concat(securedContainer);
			}
		}

		if (this.config.saveVitality) {
			this.healthHelper.saveVitality(pmcData, postRaidData.health, sessionID);
		}

		if (this.config.useSacredAmulet) {
			const locationName = currentProfile.inraid.location.toLowerCase();
			if (locationName === "lighthouse" && postRaidData.profile.Info.Side.toLowerCase() === "usec") {
				// Decrement counter if it exists, don't go below 0
				const remainingCounter = pmcData?.Stats.Eft.OverallCounters.Items.find((x) =>
					x.Key.includes("UsecRaidRemainKills")
				);
				if (remainingCounter?.Value > 0) {
					remainingCounter.Value--;
				}
			}
		}

		const isDead = this.isPlayerDead(postRaidData.exit);
		if (isDead) {
			this.pmcChatResponseService.sendKillerResponse(sessionID, pmcData, postRaidData.profile.Stats.Eft.Aggressor);
			this.matchBotDetailsCacheService.clearCache();
		}

		const victims = postRaidData.profile.Stats.Eft.Victims.filter(x => x.Role === "sptBear" || x.Role === "sptUsec");
		if (victims?.length > 0) {
			this.pmcChatResponseService.sendVictimResponse(sessionID, victims, pmcData);
		}
	}

	private updateProfile(profileData: IPmcData, saveProgress: ISaveProgressRequestData, sessionID: string): void {
		// Resets skill fatigue, I see no reason to have this be configurable.
		for (const skill of saveProgress.profile.Skills.Common) {
			skill.PointsEarnedDuringSession = 0.0;
		}

		// Level
		if (this.config.profileSaving.level) {
			profileData.Info.Level = saveProgress.profile.Info.Level;
		}

		// Skills
		if (this.config.profileSaving.skills) {
			profileData.Skills = saveProgress.profile.Skills;
		}

		// Stats
		if (this.config.profileSaving.stats) {
			profileData.Stats.Eft = saveProgress.profile.Stats.Eft;
		}
		
		// Encyclopedia
		if (this.config.profileSaving.encyclopedia) {
			profileData.Encyclopedia = saveProgress.profile.Encyclopedia;
		}
		
		// Quest progress
		if (this.config.profileSaving.questProgress) {
			profileData.TaskConditionCounters = saveProgress.profile.TaskConditionCounters;

			this.validateTaskConditionCounters(saveProgress, profileData);
		}
		
		// Survivor class
		if (this.config.profileSaving.survivorClass) {
			profileData.SurvivorClass = saveProgress.profile.SurvivorClass;
		}

		// Experience
		if (this.config.profileSaving.experience) {
			profileData.Info.Experience += profileData.Stats.Eft.TotalSessionExperience;
			profileData.Stats.Eft.TotalSessionExperience = 0;
		}

		this.saveServer.getProfile(sessionID).inraid.location = "none";
	}

	// private modifyStats(originalStats: IEftStats, postRaidStats: IEftStats) {
		
	// }

	// I just yoinked this straight from InRaidHelper
	private validateTaskConditionCounters(saveProgressRequest: ISaveProgressRequestData,profileData: IPmcData): void {
		for (const backendCounterKey in saveProgressRequest.profile.TaskConditionCounters) {
			// Skip counters with no id
			if (!saveProgressRequest.profile.TaskConditionCounters[backendCounterKey].id) {
				continue;
			}

			const postRaidValue = saveProgressRequest.profile.TaskConditionCounters[backendCounterKey]?.value;
			if (typeof postRaidValue === "undefined") {
				// No value, skip
				continue;
			}

			const matchingPreRaidCounter = profileData.TaskConditionCounters[backendCounterKey];
			if (!matchingPreRaidCounter) {
				this.logger.error(this.localisationService.getText("inraid-unable_to_find_key_in_taskconditioncounters", backendCounterKey));

				continue;
			}

			if (matchingPreRaidCounter.value !== postRaidValue) {
				this.logger.error(this.localisationService.getText("inraid-taskconditioncounter_keys_differ",
					{ key: backendCounterKey, oldValue: matchingPreRaidCounter.value, newValue: postRaidValue }));
			}
		}
	}

	private getSecuredContainerAndChildren(items: Item[]): Item[] | undefined {
		const secureContainer = items.find((x) => x.slotId === EquipmentSlots.SECURED_CONTAINER);
		if (secureContainer) {
			return this.itemHelper.findAndReturnChildrenAsItems(items, secureContainer._id);
		}

		return undefined;
	}
}