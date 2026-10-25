// Shared JSDoc typedefs (documentation only — plain JS has no runtime types).

/**
 * @typedef {Object} SeoFields
 * @property {string} title
 * @property {string} slug
 * @property {string} metaDescription
 * @property {string} excerpt
 * @property {string} body           plain text, blank-line separated paragraphs
 * @property {string} scripture      primary reference
 * @property {string[]} scriptureRefs all references found
 * @property {string[]} tags
 * @property {string} focusKeyphrase
 * @property {string} speaker
 * @property {string} series
 * @property {string} date           YYYY-MM-DD service date
 */

/**
 * @typedef {Object} TranscriptResult
 * @property {"xai"|"whisper"|"none"} engine
 * @property {string} text
 * @property {Array<{text:string,start:number,end:number,speaker?:string}>} words
 * @property {number} duration
 * @property {string} [note]
 */

export {};
