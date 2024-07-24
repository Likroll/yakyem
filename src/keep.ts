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
		this.updateStats(pmcData, postRaidData, sessionID);
		
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

	private updateStats(profileData: IPmcData, saveProgress: ISaveProgressRequestData, sessionID: string): void {
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

		// Stats, not going to allow disabling as I'm not quite sure what this does.
		profileData.Stats.Eft = saveProgress.profile.Stats.Eft;
		
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

	// private handleInventory(profileData: IPmcData, saveProgress: IPostRaidPmcData, sessionID: string): void {
	// 	if (this.config.keepItemsFoundInRaid) { // Keep all items found in raid
	// 		this.inRaidHelper.setInventory(sessionID, profileData, saveProgress);
	// 	} else { // Revert back to original kit
	// 		let keptItems: Item[] = [];

	// 		this.removeItem(profileData, profileData.Inventory.questRaidItems);
	// 		this.removeItem(profileData, profileData.Inventory.sortingTable);

	// 		this.logger.info(profileData.Inventory.equipment);

	// 		// Select which slots we want to keep
	// 		for (const item of profileData.Inventory.items) {
	// 			const itemWithChildren = this.itemHelper.findAndReturnChildrenAsItems(profileData.Inventory.items, item._id);

	// 			if (item.slotId) {
	// 				if (this.config.equipmentSaving[item.slotId] || item.slotId == "hideout") {
	// 					keptItems = [...keptItems, ...itemWithChildren];
	// 				} else if (!this.config.keepItemsInSecureContainer && item.slotId == EquipmentSlots.SECURED_CONTAINER) {
	// 					keptItems = [...keptItems, ...itemWithChildren];
	// 				} else {
	// 					this.removeItem(profileData, item._id);
	// 				}
	// 			} else {
	// 				keptItems.push(item);
	// 			}
	// 		}

	// 		if (this.config.keepItemsInSecureContainer) {
	// 			const original = profileData.Inventory.items.find((x) => x.slotId === "SecuredContainer");
	// 			if (original) {
	// 				this.removeItem(profileData, original._id);
	// 			}

	// 			const secureContainer = this.getSecuredContainerAndChildren(saveProgress.Inventory.items);

	// 			keptItems = [...keptItems, ...secureContainer];
	// 		}

	// 		profileData.Inventory.items = keptItems;
	// 		profileData.Inventory.fastPanel = saveProgress.Inventory.fastPanel; // Quick access items bar
	// 		profileData.InsuredItems = [];
	// 	}
	// }

	// private removeItem(profile: IPmcData, itemId: string): void {
	// 	if (!itemId) {
	// 		this.logger.warning(this.localisationService.getText("inventory-unable_to_remove_item_no_id_given"));

	// 		return;
	// 	}

	// 	// Get children of item, they get deleted too
	// 	const itemToRemoveWithChildren = this.itemHelper.findAndReturnChildrenByItems(profile.Inventory.items, itemId);
	// 	const inventoryItems = profile.Inventory.items;
	// 	const insuredItems = profile.InsuredItems;

	// 	for (const childId of itemToRemoveWithChildren) {
	// 		// We expect that each inventory item and each insured item has unique "_id", respective "itemId".
	// 		// Therefore we want to use a NON-Greedy function and escape the iteration as soon as we find requested item.
	// 		const inventoryIndex = inventoryItems.findIndex((item) => item._id === childId);
	// 		if (inventoryIndex !== -1) {
	// 			inventoryItems.splice(inventoryIndex, 1);
	// 		} else {
	// 			this.logger.warning(
	// 				this.localisationService.getText("inventory-unable_to_remove_item_id_not_found", {
	// 					childId: childId,
	// 					profileId: profile._id
	// 				})
	// 			);
	// 		}

	// 		const insuredIndex = insuredItems.findIndex((item) => item.itemId === childId);
	// 		if (insuredIndex !== -1) {
	// 			insuredItems.splice(insuredIndex, 1);
	// 		}
	// 	}
	// }

	private getSecuredContainerAndChildren(items: Item[]): Item[] | undefined {
		const secureContainer = items.find((x) => x.slotId === EquipmentSlots.SECURED_CONTAINER);
		if (secureContainer) {
			return this.itemHelper.findAndReturnChildrenAsItems(items, secureContainer._id);
		}

		return undefined;
	}
}