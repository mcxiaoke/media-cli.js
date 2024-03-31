# media-cli.js

MediaCli is a multimedia file processing tool that utilizes ffmpeg and exiftool, among others, to compress/convert/rename/delete/organize media files, including images, videos, and audio.

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
  media_cli.js test                       Test command, do nothing
                                                         [default] [aliases: tt]
  media_cli.js dcimr <input> [options]    Rename media files by exif metadata eg
                                          . date             [aliases: dm, dcim]
  media_cli.js organize <input> [output]  Organize pictures by file modified dat
                                          e                        [aliases: oz]
  media_cli.js lrmove <input> [output]    Move JPEG output of RAW files to other
                                           folder                  [aliases: lv]
  media_cli.js thumbs <input> [output]    Make thumbs for input images
                                                                   [aliases: tb]
  media_cli.js compress <input> [output]  Compress input images to target size
                                                              [aliases: cs, cps]
  media_cli.js remove <input> [output]    Remove files by given size/width-heigh
                                          t/name-pattern/file-list
                                                              [aliases: rm, rmf]
  media_cli.js moveup <input> [output]    Move files to sub top folder or top fo
                                          lder                     [aliases: mu]
  media_cli.js prefix <input> [output]    Rename files by append dir name or str
                                          ing                  [aliases: pf, px]

Positionals:
  input  Input folder that contains files                               [string]

Options:
      --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]

Media Cli: Image/Raw/Video filename processing utilities
Copyright 2021-2025 @ Zhang Xiaoke

```

## License

    Copyright 2021-2025 github@mcxiaoke.com

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
