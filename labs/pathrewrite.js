/*
 * Project: mediac
 * Created: 2024-04-30 15:26:32
 * Modified: 2024-04-30 15:26:32
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import path from 'path'

export function pathCombine(root, input, output, options = { keepRoot: false }
) {
    const inputRelative = path.relative(options.keepRoot ? path.dirname(root) : root, input)
    console.log('relative', inputRelative)
    return path.join(output, inputRelative)
}


function showPath(root, input, output) {
    console.log('---')
    console.log('root', root)
    console.log('input', input)
    console.log('output', output)
    console.log('result', pathCombine(root, input, output))
}

showPath("\\192.168.1.110\\g\\Others\\VIDC", "\\192.168.1.110\\g\\Others\\VIDC\\COS\\CosplayTales\\myvideo.mp4", "F:\\Temp\\output")


showPath("\\192.168.1.110\\g\\Others\\.Others\\ACG\\画师", "\\192.168.1.110\\g\\Others\\.Others\\ACG\\画师\\0图片0\\SomeBody\\hello.jpg", "F:\\Temp\\output")


showPath("F:\\Pictures\\2024\\RAW", "F:\\Pictures\\2024\\RAW\\20240217图片\\Image\\JPEG\\abc.jpg", "F:\\Pictures\\2024\\JPEG")