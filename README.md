# media-cli.js

MediaCli, Photo,Video,Audio and ExifTool Utilities.

created at 2021.07

## Installation

```
npm install mediac -g
```

## Usage

```
mediac --help
```

## Command Line

```
Usage: media_cli.js <command> <input> [options]

Commands:
  media_cli.js rename <input> [options]  Rename media files in input dir by exif
                                         date            [default] [aliases: rn]
  media_cli.js organize <input>          Organize pictures by file modified date
                                                                   [aliases: oz]
  media_cli.js lrmove <input>            Move JPEG output of RAW files to other
                                         folder                    [aliases: lv]

Positionals:
  input  Input folder that contains files                               [string]

Options:
      --version   Show version number                                  [boolean]
  -h, --help      Show help                                            [boolean]
  -b, --backup                                        [boolean] [default: false]
  -p, --prefix                              [string] [default: "IMG_/DSC_/VID_"]
  -s, --suffix                                            [string] [default: ""]
  -t, --template                           [string] [default: "YYYYMMDD_HHmmss"]

Media Utilities: Rename Image/Raw/Video files by EXIF date tags

```


## License

    Copyright 2021 github@mcxiaoke.com

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.