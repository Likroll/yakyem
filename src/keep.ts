import { ApplicationContext } from "@spt/context/ApplicationContext";
import { PlayerScavGenerator } from "@spt/generators/PlayerScavGenerator";
import { HealthHelper } from "@spt/helpers/HealthHelper";
import { InRaidHelper } from "@spt/helpers/InRaidHelper";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { QuestHelper } from "@spt/helpers/QuestHelper";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { SaveServer } from "@spt/servers/SaveServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { InsuranceService } from "@spt/services/InsuranceService";
import { LocalisationService } from "@spt/services/LocalisationService";
import { MailSendService } from "@spt/services/MailSendService";
import { MatchBotDetailsCacheService } from "@spt/services/MatchBotDetailsCacheService";
import { PmcChatResponseService } from "@spt/services/PmcChatResponseService";
import { RandomUtil } from "@spt/utils/RandomUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { inject, injectable } from "tsyringe";
import { KConfig } from "./KConfig";
import { EquipmentSlots } from "@spt/models/enums/EquipmentSlots";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { LocationLifecycleService } from "@spt/services/LocationLifecycleService";
import { HashUtil } from "@spt/utils/HashUtil";
import { LocationLootGenerator } from "@spt/generators/LocationLootGenerator";
import { LootGenerator } from "@spt/generators/LootGenerator";
import { BotGenerationCacheService } from "@spt/services/BotGenerationCacheService";
import { BotLootCacheService } from "@spt/services/BotLootCacheService";
import { BotNameService } from "@spt/services/BotNameService";
import { RaidTimeAdjustmentService } from "@spt/services/RaidTimeAdjustmentService";
import { ICloner } from "@spt/utils/cloners/ICloner";
import { IEndLocalRaidRequestData } from "@spt/models/eft/match/IEndLocalRaidRequestData";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import { InventoryHelper } from "@spt/helpers/InventoryHelper";
import { IQuestStatus } from "@spt/models/eft/common/tables/IBotBase";
import { IItem } from "@spt/models/eft/common/tables/IItem";
import { Traders } from "@spt/models/enums/Traders";

@injectable()
export class KeepEquipment extends LocationLifecycleService {
	private config: KConfig = require("../config/config");

	constructor(@inject("PrimaryLogger") protected logger: ILogger,
		@inject("HashUtil") protected hashUtil: HashUtil,
		@inject("SaveServer") protected saveServer: SaveServer,
		@inject("TimeUtil") protected timeUtil: TimeUtil,
		@inject("RandomUtil") protected randomUtil: RandomUtil,
		@inject("ProfileHelper") protected profileHelper: ProfileHelper,
		@inject("DatabaseService") protected databaseService: DatabaseService,
		@inject("InRaidHelper") protected inRaidHelper: InRaidHelper,
		@inject("HealthHelper") protected healthHelper: HealthHelper,
		@inject("QuestHelper") protected questHelper: QuestHelper,
		@inject("MatchBotDetailsCacheService") protected matchBotDetailsCacheService: MatchBotDetailsCacheService,
		@inject("PmcChatResponseService") protected pmcChatResponseService: PmcChatResponseService,
		@inject("PlayerScavGenerator") protected playerScavGenerator: PlayerScavGenerator,
		@inject("TraderHelper") protected traderHelper: TraderHelper,
		@inject("LocalisationService") protected localisationService: LocalisationService,
		@inject("InsuranceService") protected insuranceService: InsuranceService,
		@inject("BotLootCacheService") protected botLootCacheService: BotLootCacheService,
		@inject("ConfigServer") protected configServer: ConfigServer,
		@inject("BotGenerationCacheService") protected botGenerationCacheService: BotGenerationCacheService,
		@inject("MailSendService") protected mailSendService: MailSendService,
		@inject("RaidTimeAdjustmentService") protected raidTimeAdjustmentService: RaidTimeAdjustmentService,
		@inject("BotNameService") protected botNameService: BotNameService,
		@inject("LootGenerator") protected lootGenerator: LootGenerator,
		@inject("ApplicationContext") protected applicationContext: ApplicationContext,
		@inject("LocationLootGenerator") protected locationLootGenerator: LocationLootGenerator,
		@inject("PrimaryCloner") protected cloner: ICloner,
		@inject("ItemHelper") protected itemHelper: ItemHelper,
		@inject("InventoryHelper") protected inventoryHelper: InventoryHelper
	) {
		super(logger, hashUtil, saveServer, timeUtil, randomUtil, profileHelper, databaseService, inRaidHelper, healthHelper, questHelper, 
			matchBotDetailsCacheService, pmcChatResponseService, playerScavGenerator, traderHelper, localisationService, insuranceService, botLootCacheService,
			configServer, botGenerationCacheService, mailSendService, raidTimeAdjustmentService, 
			botNameService, lootGenerator, applicationContext, locationLootGenerator, cloner);
	}

	protected override handlePostRaidPmc(sessionId: string, preRaidData: IPmcData, scavProfile: IPmcData, isDead: boolean, isSurvived: boolean, 
		isTransfer: boolean, request: IEndLocalRaidRequestData, locationName: string): void {
		if (!isDead) {
			super.handlePostRaidPmc(sessionId, preRaidData, scavProfile, isDead, isSurvived, isTransfer, request, locationName);
			return;
		}

		const postRaidProfile = request.results.profile;
		const preRaidDataClone = this.cloner.clone(preRaidData.Quests);
		const lostQuestItems = this.profileHelper.getQuestItemsInProfile(postRaidProfile);

		this.updateProfile(preRaidData, postRaidProfile, sessionId, preRaidDataClone);

		this.updateInventory(preRaidData, postRaidProfile, sessionId, lostQuestItems);

		const fenceId = Traders.FENCE;

		const currentFenceStanding = postRaidProfile.TradersInfo[fenceId].standing;
		preRaidData.TradersInfo[fenceId].standing = Math.min(Math.max(currentFenceStanding, -7), 15);

		scavProfile.TradersInfo[fenceId] = preRaidData.TradersInfo[fenceId];

		this.mergePmcAndScavEncyclopedias(preRaidData, scavProfile);
		
		if (this.config.saveVitality) {
			this.healthHelper.updateProfileHealthPostRaid(preRaidData, postRaidProfile.Health, sessionId, true);
		}

		if (this.config.killerMessages) {
			this.pmcChatResponseService.sendKillerResponse(sessionId, preRaidData, postRaidProfile.Stats.Eft.Aggressor);
		}
		
		this.matchBotDetailsCacheService.clearCache();

		if (this.config.victimMessages) {
			const victims = postRaidProfile.Stats.Eft.Victims.filter(
				(victim) => ["pmcbear", "pmcusec"].includes(victim.Role.toLowerCase())
			);
			if (victims?.length > 0) {
				this.pmcChatResponseService.sendVictimResponse(sessionId, victims, preRaidData);
			}
		}

		this.handleInsuredItemLostEvent(sessionId, preRaidData, request, locationName);
	}

	private updateInventory(preRaidData: IPmcData, postRaidData: IPmcData, sessionID: string, lostQuestItems: IItem[]) {
		if (!this.config.keepQuestItems) {
			for (const item of lostQuestItems) {
				this.inventoryHelper.removeItem(postRaidData, item._id, sessionID);
			}

			this.checkForAndFixPickupQuestsAfterDeath(sessionID, lostQuestItems, preRaidData.Quests);
		}

		postRaidData.Inventory.items = 
			this.itemHelper.replaceIDs(postRaidData.Inventory.items, postRaidData, postRaidData.InsuredItems, postRaidData.Inventory.fastPanel);

		if (this.config.keepItemsFoundInRaid) {
			this.inRaidHelper.setInventory(sessionID, preRaidData, postRaidData, this.config.retainFoundInRaidStatus, false);
		} else if (this.config.keepItemsInSecureContainer) {
			const securedContainer = this.getSecuredContainerAndChildren(postRaidData.Inventory.items);

			if (securedContainer) {
				preRaidData = this.profileHelper.removeSecureContainer(preRaidData);
				preRaidData.Inventory.items = preRaidData.Inventory.items.concat(securedContainer);
			}
		}

		if (!this.config.retainFoundInRaidStatus) {
			this.inRaidHelper.removeFiRStatusFromItemsInContainer(sessionID, preRaidData, preRaidData.Inventory.equipment)
		}
	}

	private getSecuredContainerAndChildren(items: IItem[]): IItem[] | undefined {
		const secureContainer = items.find((x) => x.slotId === EquipmentSlots.SECURED_CONTAINER);
		if (secureContainer) {
			return this.itemHelper.findAndReturnChildrenAsItems(items, secureContainer._id);
		}

		return undefined;
	}

	private updateProfile(preRaidData: IPmcData, postRaidData: IPmcData, sessionID: string, dataClone: IQuestStatus[]): void {
		// Resets skill fatigue
		for (const skill of postRaidData.Skills.Common) {
			skill.PointsEarnedDuringSession = 0.0;
		}

		// Level
		if (this.config.profileSaving.level) {
			preRaidData.Info.Level = postRaidData.Info.Level;
		}

		// Skills
		if (this.config.profileSaving.skills) {
			preRaidData.Skills = postRaidData.Skills;
		}

		// Stats
		if (this.config.profileSaving.stats) {
			preRaidData.Stats.Eft = postRaidData.Stats.Eft;
		}
		
		// Encyclopedia
		if (this.config.profileSaving.encyclopedia) {
			preRaidData.Encyclopedia = postRaidData.Encyclopedia;
		}
		
		// Quest progress
		if (this.config.profileSaving.questProgress || !this.config.keepQuestItems) {
			preRaidData.TaskConditionCounters = postRaidData.TaskConditionCounters;
			preRaidData.Quests = this.processPostRaidQuests(postRaidData.Quests);

			this.lightkeeperQuestWorkaround(sessionID, postRaidData.Quests, dataClone, preRaidData);
		}
		
		// Survivor class
		if (this.config.profileSaving.survivorClass) {
			preRaidData.SurvivorClass = postRaidData.SurvivorClass;
		}

		preRaidData.WishList = postRaidData.WishList;

		// Experience
		if (this.config.profileSaving.experience) {
			preRaidData.Info.Experience += preRaidData.Stats.Eft.TotalSessionExperience;
		}

		this.applyTraderStandingAdjustments(preRaidData.TradersInfo, postRaidData.TradersInfo);

		preRaidData.Stats.Eft.TotalSessionExperience = 0;
	}
}