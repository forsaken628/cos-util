/**
 * Created by michael on 2017/6/21.
 */
const Cos = require('../lib/cos')
const config = require('./config.test')
const assert = require('assert')

describe('listObject 列出目录', function () {
  let c = new Cos(config)
  it('基本功能', function (done) {
    c.listObject({
      Bucket: 'costest',
      Region: 'cn-south'
    }).then(result => {
      assert.equal(result.dirs.length, 3, '读取目录')
      assert.equal(result.objects.length, 4, '读取文件')
      done()
    })
  })
  it('分页', function (done) {
    c.listObject({
      Bucket: 'costest',
      Region: 'cn-south',
      MaxParts: 2
    }).then(result => {
      assert.equal(result.dirs.length, 3, '读取目录')
      assert.equal(result.objects.length, 4, '读取文件')
      done()
    })
  })
})
