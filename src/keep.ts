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
		const pmcData = currentProfile.characters.pmc;

		currentProfile.inraid.character = "pmc";

		this.inRaidHelper.updateProfileBaseStats(pmcData, postRaidData, sessionID);

		if (!this.config.retainFoundInRaidStatus) {
			postRaidData.profile = this.inRaidHelper.removeSpawnedInSessionPropertyFromItems(postRaidData.profile);
		}

		postRaidData.profile.Inventory.items = 
			this.itemHelper.replaceIDs(postRaidData.profile.Inventory.items, postRaidData.profile,  pmcData.InsuredItems, postRaidData.profile.Inventory.fastPanel);

		this.inRaidHelper.addStackCountToMoneyFromRaid(postRaidData.profile.Inventory.items);

		if (this.config.keepItemsFoundInRaid) {
			this.inRaidHelper.setInventory(sessionID, pmcData, postRaidData.profile);
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

}