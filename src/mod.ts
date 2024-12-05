import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { DependencyContainer } from "@spt/models/external/tsyringe";
import { KeepEquipment } from "./keep";
import { KConfig } from "./KConfig";

class Mod implements IPreSptLoadMod {
	private config: KConfig = require("../config/config");

	public preSptLoad(container: DependencyContainer): void {
		if (this.config.active) {
			container.register<KeepEquipment>("KeepEquipment", KeepEquipment);
			container.register("LocationLifecycleService", {useToken: "KeepEquipment"});
		}
	}
}

module.exports = { mod: new Mod() }