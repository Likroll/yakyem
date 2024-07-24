export type KConfig = {
	active: boolean;
	keepItemsFoundInRaid: boolean;
	keepItemsInSecureContainer: boolean;
	retainFoundInRaidStatus: boolean;
	useSacredAmulet: boolean;
	saveVitality: boolean;

	profileSaving: {
		level: boolean;
		experience: boolean;
		skills: boolean;
		encyclopedia: boolean;
		questProgress: boolean;
		survivorClass: boolean
	};
};
