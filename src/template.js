(function(exports) {
    const fs = require('fs');
    const path = require('path');
    const SegDoc = require('./seg-doc');
    const Words = require('./words');
    const RE_ELLIPSIS = new RegExp(`${Words.U_ELLIPSIS} *$`);
    const DEFAULT_PROP = 'en';
    const MIN_PHRASE = 8;
    const MAX_LEVENSHTEIN = 2;
    const RE_TRIM_ELLIPSIS = /\s*[,.;\u2026].*$/u;
    const RE_PUNCT_END = /[.,;].*$/u;

    class Template {
        constructor(parms={}) {
            var segments = parms.segments;
            if (!(segments instanceof Array)) {
                throw new Error('expected Array of segments');
            }
            this.segments = segments;

            var alternates = parms.alternates;
            if (typeof alternates === 'string') {
                alternates = [alternates];
            }
            if (!(alternates instanceof Array)) {
                throw new Error('expected array of alternates');
            }
            this.alternates = alternates;

            this.prop = parms.prop || DEFAULT_PROP;
            this.candidates = parms.candidates;

            var seg0text = segments[0][this.prop];
            var alt0 = alternates[0];
            var seg0parts = seg0text.split(alt0);
            this.prefix = parms.prefix || seg0parts[0];

            this.reAlternates = new RegExp(`${alternates.join('|')}`,'u');
            this.prefixLen = this.prefix.length;
        }

        static levenshtein(s,t) {
            if (s.length == 0) {
                return t.length;
            }
            if (t.length == 0) {
                return s.length;
            }
            var d = new Array(s.length+1).fill(null).map(() => new Array(t.length+1).fill(null));
            for (var i = 0; i <= s.length; i++) {
                d[i][0] = i;
            }
            for (var j = 0; j <= t.length; j++) {
                d[0][j] = j;
            }

            for (var i = 1; i <= s.length; i++) {
                var si = s.charAt(i - 1);
                for (var j = 1; j <= t.length; j++) {
                    var tj = t.charAt(j - 1);
                    var cost = si === tj ? 0 : 1;
                    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + cost);
                }
            }
            return d[s.length][t.length];
        }
        
        static commonPhrase(a,b, minLength=MIN_PHRASE) {
            var x = a.split(' ');
            var y = b.split(' ');
            var c = new Array(x.length+1).fill(null).map(() => new Array(y.length+1).fill(null));
            for (var i = 0; i <= x.length; i++) {
                c[i][0] = 0;
            }
            for (var j = 0; j <= y.length; j++) {
                c[0][j] = 0;
            }
            var lcs = []
            for (var i = 1; i <= x.length; i++) {
                for (var j = 1; j <= y.length; j++) {
                    if (x[i-1] === y[j-1]) {
                        c[i][j] = c[i-1][j-1] + 1;
                        lcs[c[i][j]] = x[i-1];
                    } else if (c[i][j-1] > c[i-1][j]) {
                        c[i][j] = c[i][j-1];
                    } else {
                        c[i][j] = c[i-1][j];
                    }
                }
            }
            while (1 < lcs.length) {
                if (a.indexOf(`${lcs[0]} ${lcs[1]}`) < 0) {
                    lcs.shift();
                } else if (a.indexOf`${lcs[lcs.length-2]} ${lcs[lcs.length-1]}` < 0) {
                    lcs.pop();
                }
                var pat = lcs.join(' ');
                if (a.indexOf(pat) >= 0 && b.indexOf(pat) >= 0) {
                    if (pat.length < minLength) {
                        return '';
                    }
                    return pat;
                }
            }
            return '';
        }
                            
        static stripValue(value) {
            var words = value.split(' ');
            var len = words.length;
            if (len>=3 && words[len-1] === words[len-3]) {
                return words[len-1]; // earth as earth => earth
            }
            return value;
        }

        static findAlternates(segments, prop=DEFAULT_PROP) {
            var ie = SegDoc.findIndexes(segments, RE_ELLIPSIS, {prop});

            if (ie.length === 0) {
                return null; // segments are fully expanded
            }
            if (ie.length <= 1) {
                throw new Error(`not implemented:`+
                    JSON.stringify(segments[ie[0]]));
            }

            /* 
             * The first alternate is found by searching back for a phrase common
             * to the first and second alternate segments. 
             */
            var phrase = '';
            for (var it = ie[0]; !phrase && 0 <= --it; ) {
                phrase = Template.commonPhrase(segments[ie[0]][prop], segments[it][prop]);
            }
            if (!phrase) {
                console.error(`no expansion template for alternate:`+ 
                    JSON.stringify(segments[ie[0]],null,2));
                return null;
            }

            /*
             * The substitution prefix is found on the second alternate 
             * (i.e., the segment with the first ellipsis).
             */
            var text1 = segments[ie[0]][prop];
            var prefix = text1.substring(0, text1.indexOf(phrase) + phrase.length + 1);

            var values = [];
            if (ie[0]+1 !== ie[1]) { // discontinguous alternates
                indexes = SegDoc.findIndexes(segments, `${phrase}`, {prop});
                it = indexes[0];
                var prevIndex = -1;
                values = indexes.reduce((acc,iseg,i) => {
                    var text = segments[iseg][prop];
                    var alt = text.split(phrase)[1].trim();
                    if (i === prevIndex+1) {
                        acc.push(alt.replace(RE_TRIM_ELLIPSIS,''));
                    }
                    prevIndex = i;
                    return acc;
                }, []);
            } else { // phrase cannot be used, so assume continguous alternates
                var indexes = [it];
                var alt0 = segments[it][prop].split(phrase)[1].trim();
                alt0 = alt0.replace(RE_PUNCT_END,'');
                values = [Template.stripValue(alt0)];
                for (var i = 0; i<ie.length; i++ ) {
                    if (i && ie[i-1]+1 !== ie[i]){
                        break; // non-consecutive
                    }
                    var seg = segments[ie[i]];
                    var alt = seg[prop];
                    var phrased = alt.split(phrase);
                    if (phrased.length > 1) {
                        alt = phrased[1].trim();
                        alt = alt.replace(RE_TRIM_ELLIPSIS, ''); 
                    } else {
                        alt = alt.replace(RE_TRIM_ELLIPSIS, ''); 
                    }
                    if (i === 1) {
                        var prefix = Template.commonPhrase(values[1], alt);
                        if (prefix === '') {
                            var words1 = values[1].split(' ');
                            var words2 = alt.split(' ');
                            values[1] = words1.slice(words1.length-words2.length)
                                .join(' ');
                            prefix = segments[ie[0]][prop]
                                .replace(new RegExp(`${values[1]}.*`), '');
                        }
                    }
                    values.push(alt);
                    indexes.push(ie[i]);
                }
            }

            if (indexes.length > 1 && 1 < indexes[1] - indexes[0]) { 
                // possible closing alt
                var template2 = segments[indexes[0]+1][prop];
                var iEnd = indexes[indexes.length - 1] + 1;
                var end2 = segments[iEnd+1][prop];
                var endPhrase = Template.commonPhrase(template2, end2);
                if (endPhrase) {
                    var altEnd = segments[iEnd][prop].replace(RE_PUNCT_END, '');
                    if (altEnd) {
                        indexes.push(iEnd);
                        altEnd = altEnd.replace(prefix, '');
                        values.push(Template.stripValue(altEnd));
                    }
                }
            }

            var templateLength = indexes[1] - indexes[0];
            var template = [];
            for (var i = indexes[0]; i < indexes[1]; i++) {
                if (segments[i][prop].indexOf(values[1]) >= 0) {
                    break;
                }
                template.push(segments[i]);
            }
            
            var start = indexes[0];
            while (start>0 && segments[start-1][prop].indexOf(values[0]) >= 0) {
                start--;
            }

            return {
                phrase,
                prefix,
                values,
                indexes,
                template,
                start,
                length: indexes[indexes.length-1] - start + template.length,
            }
        }

        expand(segment) {
            var src = this.segments[0][this.prop];
            var dst = segment[this.prop];
            var dstTokens = dst.split(this.reAlternates);
            if (dstTokens.length < 1) {
                throw new Error(`could not find anything to expand:${dst}`);
            }
            var repLen = (dst.length - dstTokens.join('').length)/(dstTokens.length-1);
            var repStart = dstTokens[0].length;
            var replacement = dst.substring(repStart,repStart+repLen);
            var scid = segment.scid;
            return this.segments.map((seg,i) => {
                var re = new RegExp(this.alternates[0], 'ug'); // WARNING: RegExp g is stateful
                var propCopy = seg[this.prop].replace(re, replacement);
                if (i === 0) {
                    var prefix = dstTokens[0] || this.prefix;
                    propCopy = prefix + propCopy.substring(this.prefixLen);
                }
                return {
                    scid: `${scid}.${i+1}`,
                    [this.prop]: propCopy,
                };
            });
        }

    }

    module.exports = exports.Template = Template;
})(typeof exports === "object" ? exports : (exports = {}));

