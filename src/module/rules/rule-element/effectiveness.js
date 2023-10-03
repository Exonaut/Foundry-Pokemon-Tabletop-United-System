import { sluggify } from "../../../util/misc.js";
import { ImmunityData, ResistanceData, WeaknessData } from "../../actor/iwr.js";
import { PTUModifier } from "../../actor/modifiers.js";
import { PTUPredicate } from "../../system/predication.js";
import { ResolvableValueField } from "../../system/schema-data-fields.js";
import { RuleElementPTU } from "./base.js";

class EffectivenessRuleElement extends RuleElementPTU {
    constructor(source, item, options) {
        super(source, item, options);
    }

    /** @override */
    static defineSchema() {
        const { fields } = foundry.data;

        return {
            ...super.defineSchema(),
            type: new fields.StringField({required: true, blank: false, initial: undefined}),
            value: new fields.NumberField({required: true, blank: false, initial: 1})
        };
    }

    /** @override */
    beforePrepareData() {
        if(this.ignored) return;

        const slug = this.slug ?? sluggify(this.reducedLabel);

        function isValidValue(num) {
            if (num === 1 || num === 0) return true;
            if (num > 1) {
                return Math.log2(num) % 1 === 0;
            }
            if (num < 0.5) return isValidValue(num/0.5);
            else return num === 0.5;
        }

        if(!isValidValue(this.value)) {
            return this.failValidation("Value must be base 0.5 or base 2");
        }

        function isValidType(type) {
            return Object.keys(CONFIG.PTU.data.typeEffectiveness).includes(type.capitalize());
        }

        if(!isValidType(this.type)) {
            return this.failValidation("Type must be a valid type");
        }

        const construct = (options = {}) => {
            if(this.ignored) return null;

            const predicate = new PTUPredicate(this.resolveInjectedProperties(this.predicate));
            const test = predicate.test(options.test);

            if(!test) return null;
            if(this.value === 1) return null;

            if(this.value === 0) return new ImmunityData({type: this.type, source: this.item.uuid});
            if(this.value > 1) return new WeaknessData({type: this.type, value: this.value, source: this.item.uuid});
            if(this.value < 1) return new ResistanceData({type: this.type, value: this.value, source: this.item.uuid});

            return null;
        } 

        this.actor.synthetics.effectiveness.push(construct);
    }
}

export { EffectivenessRuleElement }