# Yet Another Keep Your Equipment Mod
Allows you to keep your equipment after death!\
[SPT Mod Page](https://hub.sp-tarkov.com/files/file/2162-yet-another-keep-your-equipment-mod/)

## Config Options Explained
Config file can be found at `mod_folder/config/config.json`.\
To enable/disable a feature, simple change between true(on) and false(off).

`active` : Controls whether the mod actually does anything.\
`keepItemsFoundInRaid` : Should items found in-raid be saved, you will be set back to the equipment you had pre-raid if this is disabled.\
`keepItemsInSecureContainer` : Should the items in your secure container revert to pre-raid. Redundant if `keepItemsFoundInRaid` is enabled.\
`retainFoundInRaidStatus` : Should items found in-raid, retain that status on death.\
`saveVitality` : Should health, status effects, energy, hydration, etc be saved. You will be set back to normal health upon death if disabled.\
`keepQuestItems` : Should quest items (aka task items) be kept after death.\
`killerMessages` : Should you receive messages from your killer.\
`victimMessages` : Should you receive messages from your victims.

`profileSaving` : What parts of the profile should be saved on death, has had no extensive testing done yet so use at your own risk.