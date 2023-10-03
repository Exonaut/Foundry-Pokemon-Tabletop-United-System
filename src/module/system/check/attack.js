import { sluggify } from "../../../util/misc.js";
import { PTUModifier, StatisticModifier } from "../../actor/modifiers.js";
import { PTUCondition } from "../../item/index.js";
import { PTUDiceCheck } from "./check.js";
import { AttackRoll } from "./rolls/attack-roll.js";

class PTUAttackCheck extends PTUDiceCheck {

    get isSelfAttack() {
        return this._isSelfAttack ??= this.selectors.includes("self-attack");
    }
    get isRangedAttack() {
        return this._isRangedAttack ??= this.selectors.includes("ranged-attack");
    }

    get rollCls() {
        return AttackRoll;
    }

    /* -------------------------------------------- */
    /* Preperation                                  */
    /* -------------------------------------------- */

    /** @override */
    async prepareContexts(attackStatistic = null) {
        if (this.isSelfAttack) {
            const context = await this.actor.getContext({
                selfToken: this.token,
                targetToken: this.token,
                selfItem: this.item,
                domains: this.context.domains,
                statistic: attackStatistic
            });
            this._contexts = new Collection([[context.actor.uuid, context]]);
        }
        else await super.prepareContexts(attackStatistic);
    }

    /**
     * @override
     * @returns {PTUAttackCheck}
     */
    prepareModifiers() {
        super.prepareModifiers();

        const modifiers = [
            new PTUModifier({
                slug: "accuracy-check",
                label: "Accuracy Check",
                modifier: isNaN(Number(this.item.system.ac)) ? Infinity : -Number(this.item.system.ac)
            }),
            ...this.modifiers
        ]

        if (this.actor.system.modifiers.acBonus.total != 0) {
            modifiers.push(new PTUModifier({
                slug: "accuracy-bonus",
                label: "Accuracy Bonus",
                modifier: this.actor.system.modifiers.acBonus.total
            }));
        }

        this.modifiers = modifiers;

        return this;
    }

    /**
     * @override
     * @returns {PTUAttackCheck}
     */
    prepareStatistic() {
        super.prepareStatistic(sluggify(game.i18n.format("PTU.Action.AttackRoll", { move: this.item.name })));
        return this;
    }

    /* -------------------------------------------- */
    /* Execution                                    */
    /* -------------------------------------------- */

    /**
     * @override 
     * @param {boolean} isReroll
     * @param {CheckCallback} callback
    */
    async execute(callback, isReroll = false) {
        const title = game.i18n.format("PTU.Action.AttackRoll", { move: this.item.name });
        const diceSize = 20;

        const attack = (() => {
            if (!this.item || !this.actor) return null;

            const attack = this.actor.system.attacks.get(this.item.realId);
            if (!attack) return null;

            return {
                actor: this.actor.uuid,
                id: attack.item.realId ?? attack.item._id,
                name: attack.item.name,
                targets: (() => {
                    const targets = this.contexts;
                    if (!targets) return null;

                    return targets.map(target => ({
                        actor: target.actor?.uuid,
                        token: target.token?.uuid ?? target.token?.id
                    }));
                })(),
            }
        })();

        /** @type {DcCollection} */
        const dcs = (() => {
            const targets = new Map();
            const critMod = this.actor.system.modifiers?.critRange?.total ?? 0;
            const critRange = Array.fromRange(1 + Math.max(critMod, 0), 20 - Math.max(critMod, 0));

            /** @type {TargetContext[]} */
            const contexts = this._contexts.size > 0 ? this._contexts : [{ actor: this.actor, options: this.options, token: this.token}]

            for (const context of contexts) {
                const target = {
                    uuid: context.actor.uuid,
                    critRange
                }

                if(context.options.has("target:condition:vulnerable")) {
                    target.slug = "vulnerable";
                    target.value = 0;
                    targets.set(context.actor.uuid, target);
                    continue;
                }

                const stuck = (context.options.has("target:condition:stuck") && !context.options.has("target:types:ghost"));
                switch (this.item?.system.category) {
                    case "Status": {
                        target.slug = "speed-evasion";
                        target.value = stuck ? 0 : (context.actor.system.evasion.speed ?? 0);
                    }
                    case "Physical": {
                        const {physical, speed} = context.actor.system.evasion;
                        if(stuck ? true : physical > speed) {
                            target.slug = "physical-evasion";
                            target.value = physical;
                        }
                        else {
                            target.slug = "speed-evasion";
                            target.value = speed;
                        }
                    }
                    case "Special": {
                        const {special, speed} = context.actor.system.evasion;
                        if(stuck ? true : special > speed) {
                            target.slug = "special-evasion";
                            target.value = special;
                        }
                        else {
                            target.slug = "speed-evasion";
                            target.value = speed;
                        }
                    }
                }

                targets.set(context.actor.uuid, target);
            }

            return {
                base: null,
                baseCritRange: null,
                targets
            }
        })();

        return await super.execute({
            diceSize,
            isReroll,
            attack,
            title,
            dcs,
            type: "attack"
        },
            callback
        );
    }

    /** @override */
    async afterRoll() {
        if(this.conditionOptions.has("condition:confused")) await PTUCondition.HandleConfusion(this.item, this.actor);
        await super.afterRoll();
    }

    /** @override */
    createFlavor({ extraTags = [], inverse = false, title }) {
        const base = super.createFlavor({ extraTags, inverse, title });

        const typeAndCategoryHeader = (() => {
            const header = document.createElement("div");
            header.classList.add("header-bar");
            header.classList.add("type-category");

            const type = document.createElement("div");
            type.classList.add("type-img");

            const typeImg = document.createElement("img");
            typeImg.src = CONFIG.PTU.data.typeEffectiveness[this.item.system.type].images.bar;
            type.append(typeImg);

            const category = document.createElement("div");
            category.classList.add("type-img");

            const categoryImg = document.createElement("img");
            categoryImg.src = `/systems/ptu/static/css/images/categories/${this.item.system.category}.png`;
            category.append(categoryImg);

            header.append(category, type);
            return header
        })();

        return [base.at(0), typeAndCategoryHeader, base.at(1)]
    }

    /**
     * Fully Executes the attack, including all checks and preparations
     * @param {StatisticModifier?} attackStatistic
     * @param {CheckCallback?} callback
     * @returns {Promise<AttackRoll>}
     */
    async executeAttack(callback = null, attackStatistic = null) {
        await this.prepareContexts(attackStatistic);
        if(!this.attackNoTargets()) return null;
        if(!this.attackOutOfRange()) return null;
        if(!this.attackDisabled()) return null;

        this.prepareModifiers();
        this.prepareStatistic();

        await this.beforeRoll();
        const roll = await this.execute(callback);
        await this.afterRoll();

        return roll;
    }

    /* -------------------------------------------- */
    /* Fail Checks                                  */
    /* -------------------------------------------- */

    /**
     * Checks whether evaluation should be halted due to the attack lacking the required range.
     * @returns {boolean}
     */
    attackOutOfRange() {
        if (!this.isSelfAttack && game.settings.get("ptu", "automation.failAttackIfOutOfRange")) {
            for (const context of this.contexts) {
                if (typeof context.distance !== "number") continue;

                const range = (() => {
                    if (this.isRangedAttack) return this.item.system.range.match(/\d+/)?.[0] ?? 1;
                    return 1;
                })();

                if (context.distance > range) {
                    ui.notifications.warn("PTU.Action.AttackOutOfRange", { localize: true });
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Checks whether evaluation should be halted due to the attack lacking the required targets.
     * @returns {boolean}
     */
    attackNoTargets() {
        if (game.settings.get("ptu", "automation.failAttackIfNoTarget")) {
            if (this._contexts.size === 0) {
                ui.notifications.warn("PTU.Action.NoTarget", { localize: true });
                return false;
            }
        }
        return true;
    }

    /**
     * Checks whether evaluation should be halted due to the attack being disabled through some condition
     * @returns {boolean}
     */
    attackDisabled() {
        if (this.options.has("condition:cannot-attack")) {
            ui.notifications.warn("PTU.Action.CannotAttack", { localize: true });
            return false;
        }
        if (this.conditionOptions.has("condition:frozen")) {
            ui.notifications.warn("PTU.Action.MoveWhileFrozen", { localize: true });
            return false;
        }
        if (this.conditionOptions.has("condition:sleep")) {
            ui.notifications.warn("PTU.Action.MoveWhileSleeping", { localize: true });
            return false;
        }
        if (this.conditionOptions.has("condition:rage") && selectors.includes("status-attack")) {
            ui.notifications.warn("PTU.Action.StatusAttackWhileRaging", { localize: true });
            return false;
        }
        if (this.conditionOptions.has("condition:disabled") && rollOptions.includes(`condition:disabled:${move.slug}`)) {
            ui.notifications.warn("PTU.Action.DisabledMove", { localize: true });
            return false;
        }
        if (this.conditionOptions.has("condition:suppressed") && !selectors.includes(`at-will-attack`)) {
            ui.notifications.warn("PTU.Action.SuppressedMove", { localize: true });
            return false;
        }
        return true;
    }


}

export { PTUAttackCheck }