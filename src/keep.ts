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
import { BodyPartHealth as IBotHealth } from "@spt/models/eft/common/tables/IBotBase";
import { BodyPartHealth as ISyncHealth } from "@spt/models/eft/health/ISyncHealthRequestData";

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
		let preRaidData: IPmcData = currentProfile.characters.pmc;

		currentProfile.inraid.character = "pmc";

		// Sets xp, skill fatigue, location status, encyclopedia, etc
		this.updateProfile(preRaidData, postRaidData, sessionID);
		
		if (!this.config.retainFoundInRaidStatus) {
			postRaidData.profile = this.inRaidHelper.removeSpawnedInSessionPropertyFromItems(postRaidData.profile);
		}

		postRaidData.profile.Inventory.items = 
			this.itemHelper.replaceIDs(postRaidData.profile.Inventory.items, postRaidData.profile,  preRaidData.InsuredItems, postRaidData.profile.Inventory.fastPanel);
		
		this.inRaidHelper.addStackCountToMoneyFromRaid(postRaidData.profile.Inventory.items);

		if (this.config.keepItemsFoundInRaid) {
			this.inRaidHelper.setInventory(sessionID, preRaidData, postRaidData.profile);
		} else if (this.config.keepItemsInSecureContainer) {
			const securedContainer = this.getSecuredContainerAndChildren(postRaidData.profile.Inventory.items);

			if (securedContainer) {
				preRaidData = this.profileHelper.removeSecureContainer(preRaidData);
				preRaidData.Inventory.items = preRaidData.Inventory.items.concat(securedContainer);
			}
		}

		if (this.config.saveVitality) {
			this.healthHelper.saveVitality(preRaidData, postRaidData.health, sessionID);
		} else {
			// This should remove any effects on the body
			for (const id in preRaidData.Health.BodyParts) {
				const bodyPart: IBotHealth = preRaidData.Health.BodyParts[id];
				bodyPart.Effects = undefined;
			}

			for (const id in postRaidData.health.Health) {
				const bodyPart: ISyncHealth = preRaidData.Health.BodyParts[id];
				bodyPart.Effects = undefined;
			}
		}

		if (this.config.useSacredAmulet) {
			const locationName = currentProfile.inraid.location.toLowerCase();
			if (locationName === "lighthouse" && postRaidData.profile.Info.Side.toLowerCase() === "usec") {
				// Decrement counter if it exists, don't go below 0
				const remainingCounter = preRaidData?.Stats.Eft.OverallCounters.Items.find((x) =>
					x.Key.includes("UsecRaidRemainKills")
				);
				if (remainingCounter?.Value > 0) {
					remainingCounter.Value--;
				}
			}
		}

		const isDead = this.isPlayerDead(postRaidData.exit);
		if (isDead) {
			this.pmcChatResponseService.sendKillerResponse(sessionID, preRaidData, postRaidData.profile.Stats.Eft.Aggressor);
			this.matchBotDetailsCacheService.clearCache();
		}

		const victims = postRaidData.profile.Stats.Eft.Victims.filter(x => x.Role === "sptBear" || x.Role === "sptUsec");
		if (victims?.length > 0) {
			this.pmcChatResponseService.sendVictimResponse(sessionID, victims, preRaidData);
		}
	}

	private updateProfile(preRaidData: IPmcData, saveProgress: ISaveProgressRequestData, sessionID: string): void {
		// Resets skill fatigue, I see no reason to have this be configurable.
		for (const skill of saveProgress.profile.Skills.Common) {
			skill.PointsEarnedDuringSession = 0.0;
		}

		// Level
		if (this.config.profileSaving.level) {
			preRaidData.Info.Level = saveProgress.profile.Info.Level;
		}

		// Skills
		if (this.config.profileSaving.skills) {
			preRaidData.Skills = saveProgress.profile.Skills;
		}

		// Stats
		if (this.config.profileSaving.stats) {
			preRaidData.Stats.Eft = saveProgress.profile.Stats.Eft;
		}
		
		// Encyclopedia
		if (this.config.profileSaving.encyclopedia) {
			preRaidData.Encyclopedia = saveProgress.profile.Encyclopedia;
		}
		
		// Quest progress
		if (this.config.profileSaving.questProgress) {
			preRaidData.TaskConditionCounters = saveProgress.profile.TaskConditionCounters;

			this.validateTaskConditionCounters(saveProgress, preRaidData);
		}
		
		// Survivor class
		if (this.config.profileSaving.survivorClass) {
			preRaidData.SurvivorClass = saveProgress.profile.SurvivorClass;
		}

		// Experience
		if (this.config.profileSaving.experience) {
			preRaidData.Info.Experience += preRaidData.Stats.Eft.TotalSessionExperience;
			preRaidData.Stats.Eft.TotalSessionExperience = 0;
		}

		this.saveServer.getProfile(sessionID).inraid.location = "none";
	}

	// private modifyStats(originalStats: IEftStats, postRaidStats: IEftStats) {
		
	// }

	// I just yoinked this straight from InRaidHelper
	private validateTaskConditionCounters(saveProgressRequest: ISaveProgressRequestData, preRaidData: IPmcData): void {
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

			const matchingPreRaidCounter = preRaidData.TaskConditionCounters[backendCounterKey];
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