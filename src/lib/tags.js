'use strict';

/** 语法点标签。加新专题时在这里追加一行，题库和统计会自动识别。 */
const RULE_TAGS = [
  { key: 'reg_er',        zh: '单音节 +er/-est',        en: 'short adj + -er/-est' },
  { key: 'reg_e',         zh: '以 e 结尾 +r/-st',       en: 'ends in -e' },
  { key: 'reg_y',         zh: '辅音+y → -ier/-iest',    en: 'consonant + -y' },
  { key: 'reg_double',    zh: '双写末尾辅音',            en: 'double final consonant' },
  { key: 'more_most',     zh: '多音节 more/most',        en: 'more / most' },
  { key: 'irregular',     zh: '不规则变化',              en: 'irregular forms' },
  { key: 'than',          zh: 'than 比较句式',           en: 'than' },
  { key: 'as_as',         zh: 'as…as 同级比较',          en: 'as … as' },
  { key: 'the_sup_range', zh: '最高级范围 in/of',        en: 'the + sup + in/of' },
  { key: 'one_of_sup',    zh: 'one of the + 最高级',     en: 'one of the + sup' },
  { key: 'degree_adv',    zh: '程度修饰 / 越来越…',       en: 'much + comp, comp and comp' },
  { key: 'comp_vs_sup',   zh: '比较级 vs 最高级',         en: 'comparative vs superlative' },
  { key: 'other',         zh: '其他',                    en: 'other' },
];

const TAG_MAP = Object.fromEntries(RULE_TAGS.map((t) => [t.key, t]));
const tagLabel = (key) => (TAG_MAP[key] ? TAG_MAP[key].zh : key);

const TYPES = [
  { key: 'choice', zh: '单选', en: 'multiple choice' },
  { key: 'fill',   zh: '填空', en: 'fill in the blank' },
  { key: 'fix',    zh: '改错', en: 'correct the error' },
];

module.exports = { RULE_TAGS, TAG_MAP, tagLabel, TYPES };
