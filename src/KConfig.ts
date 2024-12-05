export type KConfig = {
	active: boolean;
	keepItemsFoundInRaid: boolean;
	keepItemsInSecureContainer: boolean;
	retainFoundInRaidStatus: boolean;
	saveVitality: boolean;
	keepQuestItems: boolean;
	killerMessages: boolean;
	victimMessages: boolean;

	profileSaving: {
		level: boolean;
		experience: boolean;
		skills: boolean;
		encyclopedia: boolean;
		questProgress: boolean;
		survivorClass: boolean;
		stats: boolean;
	};
};
