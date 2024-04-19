const formatArgs = (str, replacements) => {
  return str.replace(/%([^%]+)%|{([^{}]+)}|@([^@]+)@|!([^!]+)!/g, (match, p1, p2, p3, p4) => {
    const placeholder = p1 || p2 || p3 || p4
    return replacements.hasOwnProperty(placeholder) ? replacements[placeholder] : match
  })
}

class Preset {
  constructor(name, {
    nameArgs,
    videoArgs,
    audioArgs,
    inputArgs,
    outputArgs,
    filters,
    complexFilter,
    extraArgs
  }) {
    this.name = name
    this.nameArgs = nameArgs
    this.videoArgs = videoArgs
    this.audioArgs = audioArgs
    this.inputArgs = inputArgs
    this.outputArgs = outputArgs
    this.filters = filters
    this.complexFilter = complexFilter
    this.extraArgs = extraArgs
  }
}

// HEVC基础参数
const HEVC_BASE = new Preset('hevc-base', {
  videoArgs: '-c:v hevc_nvenc -profile:v main -cq {quality} -tune:v hq -bufsize {bitrate} -maxrate {bitrate}',
  audioArgs: '-map a:0 -c:a libfdk_aac -b:a {bitrate}',
  nameArgs: { prefix: '[SHANA] ' },
  // 快速读取和播放
  outputArgs: '-movflags +faststart -f mp4',
  filters: "scale='if(gt(iw,{dimension}),min({dimension},iw),-1)':'if(gt(ih,{dimension}),min({dimension},ih),-1)'",
})

console.log(HEVC_BASE)


// 4K超高码率和质量
const PRESET_HEVC_ULTRA = {
  ...HEVC_BASE,
  name: 'hevc_ultra',
  videoArgs: formatArgs(HEVC_BASE.videoArgs, { quality: 20, bitrate: '20480K' }),
  audioArgs: formatArgs(HEVC_BASE.audioArgs, { bitrate: '320k' }),
  filters: formatArgs(HEVC_BASE.filters, { dimension: '3840' })
}

console.log(PRESET_HEVC_ULTRA)