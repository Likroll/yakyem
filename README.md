# Yet Another Keep Your Equipment Mod
Allows you to keep your equipment after death!

## Config Options Explained
Config file can be found at `mod_folder/config/config.json`.\
To enable/disable a feature, simple change between true(on) and false(off).

`active` : Controls whether the mod actually does anything.\
`keepItemsFoundInRaid` : Should items found in raid be saved, you will be set back to the equipment you had before the raid if this is disabled.\
`keepItemsInSecureContainer` : Should the items in your secure container remain intact. Does nothing if `keepItemsFoundInRaid` is enabled.\
`retainFoundInRaidStatus` : Should items found in raid, retain that status on death.\
`useSacredAmulet` : Should the [Sacred Amulet](https://escapefromtarkov.fandom.com/wiki/Sacred_Amulet) be used.\
`saveVitality` : Should health, status effects, energy, hydration, etc be saved. You will be set back to normal health upon death if disabled.