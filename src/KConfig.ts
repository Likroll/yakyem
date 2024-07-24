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
		stats: boolean;
		encyclopedia: boolean;
		questProgress: boolean;
		survivorClass: boolean
	};
	equipmentSaving: {
		Headwear: boolean;
		Earpiece: boolean;
		FaceCover: boolean;
		ArmorVest: boolean;
		Eyewear: boolean;
		ArmBand: boolean;
		TacticalVest: boolean;
		Pockets: boolean;
		Backpack: boolean;
		FirstPrimaryWeapon: boolean;
		SecondPrimaryWeapon: boolean;
		Holster: boolean;
		Scabbard: boolean;
	}
};
