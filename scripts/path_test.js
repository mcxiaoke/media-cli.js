import upath from 'upath'
import * as mf from '../lib/file.js'


let files = await mf.walk(process.argv[2], {
    needStats: true,
})
for (const f of files) {
    console.log('\n-----------------\n')
    console.log(f.path)
    console.log(upath.normalize(f.path))
    console.log(upath.normalizeSafe(f.path))
    console.log(upath.normalizeTrim(f.path))
}