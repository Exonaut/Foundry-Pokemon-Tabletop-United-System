import { PTUSkills, PTUActor } from "../index.js";
import { calculateEvasions, calculatePTStatTotal, calculateOldStatTotal } from "../helpers.js";
import { calculateTrainerCapabilities } from "./capabilities.js";
import { PTUModifier } from "../modifiers.js";
import { sluggify } from "../../../util/misc.js";

class PTUTrainerActor extends PTUActor {

    get allowedItemTypes() {
        return ["feat", "edge", "move", "contestmove", "ability", "item", "capability", "effect", "condition", "dexentry"]
    }

    /** @override */
    prepareBaseData() {
        super.prepareBaseData();

        const system = this.system;

        // Add Skill Background traits
        for (const skill of Object.values(system.background.pathetic)) {
            if (system.skills[skill]) {
                system.skills[skill].value.mod -= 1;
            }
        }
        const { adept, novice } = system.background;
        if (system.skills[adept]) {
            system.skills[adept].value.mod += 2;
        }
        if (system.skills[novice]) {
            system.skills[novice].value.mod += 1;
        }

        system.level.dexexp = game.settings.get("ptu", "variant.useDexExp") == true ? (this.system.dex?.owned?.length || 0) : 0;
        system.level.current =
            Math.clamped(
                1
                + Number(system.level.milestones)
                + Math.trunc((Number(system.level.miscexp) / 10) + (Number(system.level.dexexp) / 10)),
                1,
                (game.settings.get("ptu", "variant.trainerRevamp") ? 25 : 50)
            );

        // Set attributes which are underrived data
        this.attributes = {
            // "skills": Object.fromEntries(
            //     Object.entries(system.skills)
            //         .map(([key, value]) => ([key, value.value.total]))
            // ),
            level: { current: system.level.current },
            health: { current: system.health.value, temp: system.tempHp, injuries: system.health.injuries },
            skills: {}
        }
    }

    /** @override */
    prepareDerivedData() {
        super.prepareDerivedData()

        const system = this.system;
        // Prepare data with Mods.

        // Prepare data with Mods
        for (let [key, mod] of Object.entries(system.modifiers)) {
            // Skip these modifiers
            if (["hardened", "flinch_count", "immuneToEffectDamage", "typeOverwrite", "capabilities"].includes(key)) continue;

            // If the modifier is an object, it has subkeys that need to be calculated
            if (mod[Object.keys(mod)[0]]?.value !== undefined) {
                for (let [subkey, value] of Object.entries(mod)) {
                    system.modifiers[key][subkey]["total"] = (value["value"] ?? 0) + (value["mod"] ?? 0);
                }
                continue;
            }

            // Otherwise, just calculate the total
            system.modifiers[key]["total"] = (mod["value"] ?? 0) + (mod["mod"] ?? 0);
        }

        for (let [key, skill] of Object.entries(system.skills)) {
            skill["value"]["total"] = skill["value"]["value"] + skill["value"]["mod"];
            skill["rank"] = PTUSkills.getRankSlug(skill["value"]["total"]);
            skill["modifier"]["total"] = skill["modifier"]["value"] + skill["modifier"]["mod"] + (system.modifiers.skillBonus?.total ?? 0);
            this.attributes.skills[key] = this.prepareSkill(key);//PTUSkills.calculate({ actor: this, context: { skill: key, options: [] } });
        }

        // Prepare flat modifiers
        {
            const construct = ({ value, label }) => () => {
                const modifier = new PTUModifier({
                    slug: sluggify(label),
                    label,
                    modifier: value,
                })
                return modifier;
            }

            if (system.modifiers.saveChecks.total != 0) {
                const saveMods = (this.synthetics.statisticsModifiers["save-check"] ??= []);
                saveMods.push(construct({ value: system.modifiers.saveChecks.total, label: "Save Check Mod" }));
            }
        }

        // Use Data

        system.levelUpPoints = (game.settings.get("ptu", "variant.trainerRevamp") ? (system.level.current * 2) : system.level.current) + system.modifiers.statPoints.total + 9;
        if (this.flags?.ptu?.is_poisoned) {
            system.stats.spdef.stage.mod -= 2;
        }

        const leftoverLevelUpPoints = system.levelUpPoints - Object.values(system.stats).reduce((a, v) => v.levelUp + a, 0);
        const actualLevel = Math.max(1, system.level.current - Math.max(0, Math.clamped(0, leftoverLevelUpPoints, leftoverLevelUpPoints - system.modifiers.statPoints.total ?? 0)));

        system.stats.hp.base = 10
        system.stats.hp.value = system.modifiers.baseStats.hp.total + system.stats.hp.base;
        system.stats.atk.base = 5
        system.stats.atk.value = system.modifiers.baseStats.atk.total + system.stats.atk.base;
        system.stats.def.base = 5
        system.stats.def.value = system.modifiers.baseStats.def.total + system.stats.def.base;
        system.stats.spatk.base = 5
        system.stats.spatk.value = system.modifiers.baseStats.spatk.total + system.stats.spatk.base;
        system.stats.spdef.base = 5
        system.stats.spdef.value = system.modifiers.baseStats.spdef.total + system.stats.spdef.base;
        system.stats.spd.base = 5
        system.stats.spd.value = system.modifiers.baseStats.spd.total + system.stats.spd.base;

        var result = calculatePTStatTotal(system.levelUpPoints, (game.settings.get("ptu", "variant.trainerRevamp") ? actualLevel + actualLevel : actualLevel), system.stats, { twistedPower: this.rollOptions.all["self:ability:twisted-power"], hybridArmor: this.rollOptions.all["self:ability:hybrid-armor"], }, system.nature?.value, true);
        system.stats = result.stats;
        system.levelUpPoints = result.levelUpPoints;

        system.health.total = 10 + (system.level.current * (game.settings.get("ptu", "variant.trainerRevamp") ? 4 : 2)) + (system.stats.hp.total * 3);
        system.health.max = system.health.injuries > 0 ? Math.trunc(system.health.total * (1 - ((system.modifiers.hardened ? Math.min(system.health.injuries, 5) : system.health.injuries) / 10))) : system.health.total;

        system.health.percent = Math.round((system.health.value / system.health.max) * 100);
        system.health.totalPercent = Math.round((system.health.value / system.health.total) * 100);
        system.health.tick = Math.floor(system.health.total / 10);

        system.evasion = calculateEvasions(system, this.flags?.ptu, this.items);
        system.capabilities = calculateTrainerCapabilities(system.skills, this.items, (system.stats.spd.stage.value + system.stats.spd.stage.mod), system.modifiers.capabilities, this.rollOptions.conditions?.["slowed"]);

        system.feats = {
            total: this.items.filter(x => x.type == "feat" && !x.system.free).length,
            max: 4 + (game.settings.get("ptu", "variant.trainerRevamp") ? system.level.current : Math.ceil(system.level.current / 2))
        }

        system.edges = {
            total: this.items.filter(x => x.type == "edge" && !x.system.free).length,
            max: 4
                + (game.settings.get("ptu", "variant.trainerRevamp") ? system.level.current : Math.floor(system.level.current / 2))
                + (system.level.current >= 2 ? 1 : 0)
                + (system.level.current >= 6 ? 1 : 0)
                + (system.level.current >= 12 ? 1 : 0)
                + (game.settings.get("ptu", "variant.trainerRevamp") ? (system.level.current >= 5 ? 1 : 0) : 0)
                + (game.settings.get("ptu", "variant.trainerRevamp") ? (system.level.current >= 10 ? 1 : 0) : 0)
                + (game.settings.get("ptu", "variant.trainerRevamp") ? (system.level.current >= 15 ? 1 : 0) : 0)
                + (game.settings.get("ptu", "variant.trainerRevamp") ? (system.level.current >= 20 ? 1 : 0) : 0)
                + (game.settings.get("ptu", "variant.trainerRevamp") ? (system.level.current >= 25 ? 1 : 0) : 0)
        }

        system.ap.max = 5 + Math.floor(system.level.current / 5);

        system.initiative = { value: system.stats.spd.total + system.modifiers.initiative.total };

        // Contests
        // This is to force the order of the stats to be the same as the order in the sheet
        system.contests.stats = {
            cool: system.contests.stats.cool,
            tough: system.contests.stats.tough,
            beauty: system.contests.stats.beauty,
            smart: system.contests.stats.smart,
            cute: system.contests.stats.cute
        }
        for (const stat of Object.keys(system.contests.stats)) {
            const combatStat = (() => {
                switch (stat) {
                    case "cool": return "atk";
                    case "tough": return "def";
                    case "beauty": return "spatk";
                    case "smart": return "spdef";
                    case "cute": return "spd";
                }
            })();
            system.contests.stats[stat].stats.value = Math.min(Math.floor(system.stats[combatStat].total / 10), 3);
            system.contests.stats[stat].stats.mod ??= 0;
            system.contests.stats[stat].stats.total = Math.min(system.contests.stats[stat].stats.value + system.contests.stats[stat].stats.mod, 3);

            system.contests.stats[stat].dice = system.contests.stats[stat].stats.total + system.contests.voltage.value;
        }

        system.contests.appeal.mod ??= 0;
        system.contests.appeal.total = system.contests.appeal.value + system.contests.appeal.mod;

        this.attributes.health.max = system.health.max;
    }

    /** @override */
    _setDefaultChanges() {
        super._setDefaultChanges();
        const changes = { system: {} };
        for (const value of Object.values(this.system.background.pathetic)) {
            if (value && value != "blank") {
                if (!changes["system"]["skills"]) changes["system"]["skills"] = {}
                if (!changes["system"]["skills"][value]) changes["system"]["skills"][value] = {}
                if (!changes["system"]["skills"][value]['value']) changes["system"]["skills"][value]['value'] = {}
                if (!changes["system"]["skills"][value]['value']['mod']) changes["system"]["skills"][value]['value']['mod'] = {}
                changes["system"]["skills"][value]['value']['mod'][randomID()] = { mode: 'add', value: -1, source: "Pathetic Background Skills" };
            }
        }
        const { adept, novice } = this.system.background;
        if (adept && adept != "blank") {
            if (!changes["system"]["skills"]) changes["system"]["skills"] = {}
            if (!changes["system"]["skills"][adept]) changes["system"]["skills"][adept] = {}
            if (!changes["system"]["skills"][adept]['value']) changes["system"]["skills"][adept]['value'] = {}
            if (!changes["system"]["skills"][adept]['value']['mod']) changes["system"]["skills"][adept]['value']['mod'] = {}
            changes["system"]["skills"][adept]['value']['mod'][randomID()] = { mode: 'add', value: 2, source: "Adept Background Skill" };
        }
        if (novice && novice != "blank") {
            if (!changes["system"]["skills"]) changes["system"]["skills"] = {}
            if (!changes["system"]["skills"][novice]) changes["system"]["skills"][novice] = {}
            if (!changes["system"]["skills"][novice]['value']) changes["system"]["skills"][novice]['value'] = {}
            if (!changes["system"]["skills"][novice]['value']['mod']) changes["system"]["skills"][novice]['value']['mod'] = {}
            changes["system"]["skills"][novice]['value']['mod'][randomID()] = { mode: 'add', value: 1, source: "Novice Background Skill" };
        }
        this.system.changes = mergeObject(
            this.system.changes,
            changes
        );
    }
}


export { PTUTrainerActor }