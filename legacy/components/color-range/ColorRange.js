/*
---
description: Color range utility

license: MIT-style

authors: akaIDIOT

version: 0.2

requires:
  core/1.4: '*'
  more/1.4: Utilities.Color

provides: ColorRange
...
*/

var ColorRange = new Class({
    
    Extends: Array,

    from: false,
    to:   false,

    initialize: function(from, to, steps) {
        this.from = new Color(from);
        this.to   = new Color(to);

        this.setSteps(steps || 0);
    },

    setSteps: function(steps) {
        this.empty();
        for (var index = 0; index < steps; index++) {
            this.push(this.from.mix(this.to, index / (steps - 1) * 100));
        }

        return this;
    },

    apply: function(elements, property) {
        elements = $$(elements);
        if (this.length != elements.length) {
            this.setSteps(elements.length);
        }

        elements.each(function(element, index) {
            element.setStyle(property || 'background-color', this[index]);
        }, this);
        
        return this;
    }

});

Color.range = function(from, to, steps) {
    return new ColorRange(from, to, steps);
};

Color.applyRange = function(from, to, elements, property) {
    return new ColorRange(from, to, elements.length).apply(elements, property);
};

Color.implement({
    range: function(to, steps) {
        return new ColorRange(this, to, steps);
    }
});

Elements.implement({
    applyColorRange: function(from, to, property) {
        new ColorRange(from, to, this.length).apply(this, property);
        return this;
    }
});
