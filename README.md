# media-cli.js

MediaCli is a multimedia file processing tool that utilizes ffmpeg and exiftool, among others, to compress/convert/rename/delete/organize media files, including images, videos, and audio.

created at 2021.07, updated at 2026.01.16

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
==============================================================
Usage: media_cli.js <command> <input> [options]

Commands:
  media_cli.js test                         Test command, do nothing
                                                         [default] [aliases: tt]
  media_cli.js dcimr <input> [options]      Rename media files by exif metadata
                                            eg. date         [aliases: dm, dcim]
  media_cli.js organize <input> [output]    Organize pictures by file modified d
                                            ate                    [aliases: oz]
  media_cli.js lrmove <input> [output]      Move JPEG output of RAW files to oth
                                            er folder              [aliases: lv]
  media_cli.js compress <input> [output]    Compress input images to target size
                                                              [aliases: cs, cps]
  media_cli.js remove [input] [directories  Remove files by given size/width-hei
  ...]                                      ght/name-pattern/file-list
                                                              [aliases: rm, rmf]
  media_cli.js moveup <input> [output]      Move files to sub top folder or top
                                            folder                 [aliases: mp]
  media_cli.js move <input> [output]        Move files to folders by filename da
                                            te patterns            [aliases: md]
  media_cli.js prefix <input> [output]      Rename files by append dir name or s
                                            tring              [aliases: pf, px]
  media_cli.js rename <input>               Reanme files: fix encoding, replace
                                            by regex, clean chars, from tc to sc
                                            .                 [aliases: fn, fxn]
  media_cli.js zipu <input> [output]        Smart unzip command (auto detect enc
                                            oding)         [aliases: zipunicode]
  media_cli.js decode <strings...>          Decode text with messy or invalid ch
                                            ars                    [aliases: dc]
  media_cli.js ffmpeg [input] [directories  convert audio or video files using f
  ...]                                      fmpeg.
                                      [aliases: transcode, aconv, vconv, avconv]

Options:
      --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]

MediaCli is a multimedia file processing tool.
Copyright 2021-2026 @ Zhang Xiaoke

```

## License

    Copyright 2021-2026 github@mcxiaoke.com

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
