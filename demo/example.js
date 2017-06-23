/**
 * Created by michael on 2017/6/21.
 */
const Cos = require('../lib/cos')

let c = new Cos({
  AppId: '',
  SecretId: '',
  SecretKey: ''
})

let flat = false
setTimeout(() => (flat = true), 3000)

c.sliceUploadFile({
  Bucket: '',
  Region: '',
  Key: '',
  UploadId: ''
}, {
  fileName: '',
  fileSize: 19100116,
  sliceSize: 1 << 20
}, {
  onProgress: function (a) {
    console.log(a)
  },
  cancel: function () {
    return flat
  }
}).then((a) => {
  console.log(a)
}, (err) => {
  console.log(err)
})

// 直接调用cos-nodejs-sdk方法
c.cos.getBucket({
  Bucket: '',
  Region: '',
  Delimiter: '/'
}, (err, data) => {
  console.log(err, data)
})
