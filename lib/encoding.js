import iconv from 'iconv-lite';
import * as log from './debug.js';
import { strHasHiraKana, strOnlyASCII } from './unicode.js';

// https://github.com/bnoordhuis/node-iconv/
const ENCODING_FROM = [
    'ISO-8859-1',
    'UTF8',
    'UTF-16',
    'GBK',
    'SHIFT_JIS',
    'CP949',
    'EUC-KR',
    'KOI8-R',
    'KOI8-U',
    'KOI8-RU',
]

const ENCODING_TO = [
    'SHIFT_JIS',
    'GBK',
    'UTF8',
    'CP949',
    'EUC-KR',
    'KOI8-R',
    'KOI8-U',
    'KOI8-RU',
]

const REGEX_MESSY_CHARS_CJK = /[値倫倰倲倴倿偀偁偂偄偅偆偉偊偋偍偐偑偒偓偔偖偗偘偙偛偝偞偟偠偡偢偣偤偦偧偨偩偪偫偭偮偯偰偱偳側偵偸偹偺偼偽傁傂傃傄傆傇傉傊傋傌傎傏傐傑傒傓傔傕傖傗傘備傚傛傜傝傞傟傠傡傢傤傦傪傫傽傾傿僀僁僂僃僄僅僆僈僉僊僋僌働僎僐僑僒僓僔僕僗僘僙僛僜僝僞僟僠僡僢僣僤僥僨僩僪僫僯僱僲僴僶僷僸價僺僼僽僾僿儀儁儂儃億儅儈儉儊儌儍儎儏儐儑儓儔儕儖儗儘儙儚儛儜儝儞償儠儢儤儦儨優儬儮儰儲儴儶儸儺儼儽儾囥夈嬨嶃忋戙撱曘椼欍涖濄熴銇銈銉僼儕乕僫嫮惂庬晅偗漶囹芑苈蓴瑣糀瑩椹楝愛]/u

const REGEX_MESSY_CHARS_UNICODE = /[\u00a0-\u00bf\u00c0-\u017f\u0400-\u1cff\u2000-\u206f\u2500-\u257f\u0e00-\u0e7f\u3400-\u4dbf\uac00-\ud7af\ufff0-\uffff]/u


export function charUnique(str) {
    return String.prototype.concat.call(...new Set(str));
}

export function fixCJKEnc(strInput) {
    if (strHasHiraKana(strInput) || strOnlyASCII(strInput)) {
        return strInput
    }
    log.debug(`fixEnc processing ${strInput}`)
    for (const enc1 of ENCODING_FROM) {
        for (const enc2 of ENCODING_TO) {
            try {
                const strBuffer = iconv.encode(strInput, enc1)
                const strDecoded = iconv.decode(strBuffer, enc2)
                const hasHiraKana = strHasHiraKana(strDecoded)
                if (strOnlyASCII(strInput)) {
                    return strInput;
                }
                if (!strDecoded?.includes('?')
                    && !REGEX_MESSY_CHARS_UNICODE.test(strDecoded)
                    && !REGEX_MESSY_CHARS_CJK.test(strDecoded)) {
                    log.info(`fixEnc [${strInput}] => [${strDecoded}] (${enc1}->${enc2}) ${hasHiraKana}`)
                    return strDecoded
                }
            } catch (error) {
                log.info(`fixEnc ${error}`)
            }
        }
    }
    return strInput
}