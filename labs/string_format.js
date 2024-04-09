/*
 * Project: mediac
 * Created: 2021-07-26 23:02:39 +0800
 * Modified: 2024-04-09 22:15:56 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// from https://stackoverflow.com/questions/610406
// or use https://github.com/locutusjs/
String.format = function (str, arr) {
  var i = -1
  function callback(exp, p0, p1, p2, p3, p4) {
    if (exp == "%%") return "%"
    if (arr[++i] === undefined) return undefined
    exp = p2 ? parseInt(p2.substr(1)) : undefined
    var base = p3 ? parseInt(p3.substr(1)) : undefined
    var val
    switch (p4) {
      case "s":
        val = arr[i]
        break
      case "c":
        val = arr[i][0]
        break
      case "f":
        val = parseFloat(arr[i]).toFixed(exp)
        break
      case "p":
        val = parseFloat(arr[i]).toPrecision(exp)
        break
      case "e":
        val = parseFloat(arr[i]).toExponential(exp)
        break
      case "x":
        val = parseInt(arr[i]).toString(base ? base : 16)
        break
      case "d":
        val = parseFloat(
          parseInt(arr[i], base ? base : 10).toPrecision(exp)
        ).toFixed(0)
        break
    }
    val = typeof val == "object" ? JSON.stringify(val) : val.toString(base)
    var sz = parseInt(p1) /* padding size */
    var ch = p1 && p1[0] == "0" ? "0" : " " /* isnull? */
    while (val.length < sz)
      val = p0 !== undefined ? val + ch : ch + val /* isminus? */
    return val
  }
  var regex = /%(-)?(0?[0-9]+)?([.][0-9]+)?([#][0-9]+)?([scfpexd%])/g
  return str.replace(regex, callback)
}

String.prototype.$ = function () {
  return String.format(this, Array.prototype.slice.call(arguments))
}

String.format("%s %s", ["This is a string", 11])
console.log("%s %s".$("This is a string", 11))
var arr = ["12.3", 13.6]
console.log("Array: %s".$(arr))
var obj = { test: "test", id: 12 }
console.log("Object: %s".$(obj))
console.log("%c", "Test")
console.log("%5d".$(12)) // '   12'
console.log("%05d".$(12)) // '00012'
console.log("%-5d".$(12)) // '12   '
console.log("%5.2d".$(123)) // '  120'
console.log("%5.2f".$(1.1)) // ' 1.10'
console.log("%10.2e".$(1.1)) // '   1.10e+0'
console.log("%5.3p".$(1.12345)) // ' 1.12'
console.log("%5x".$(45054)) // ' affe'
console.log("%20#2x".$("45054")) // '    1010111111111110'
console.log("%6#2d".$("111")) // '     7'
console.log("%6#16d".$("affe")) // ' 45054'
