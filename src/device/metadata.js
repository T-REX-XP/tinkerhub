/**
 * Metadata as found in the public device API.
 */
class Metadata {
    constructor(owner, def) {
        this._owner = owner;

        this.id = def.id;

        this.updateDef(def);
    }

    /**
     * Set the name of the device.
     */
    setName(name) {
        return this._owner.call('_setName', [ name ]);
    }

    /**
     * Update the definition of the device.
     */
    updateDef(def) {
        this.def = def;

        let tags = def.tags.slice();

        if(def.types) {
            def.types.forEach(function(t) {
                tags.push('type:' + t);
            });
        }

        if(def.capabilities) {
            def.capabilities.forEach(function(c) {
                tags.push('cap:' + c);
            });
        }

        tags.push(def.id);

        this.tags = tags;
    }

    /**
     * Tag the device with the given arguments.
     */
    tag() {
        return this._owner.call('_addTags', [ Array.prototype.slice.call(arguments) ]);
    }

    /**
     * Remove the tags given as arguments.
     */
    removeTag() {
        return this._owner.call('_removeTags', [ Array.prototype.slice.call(arguments) ]);
    }
}

module.exports = function(id, def) {
    return new Metadata(id, def);
};