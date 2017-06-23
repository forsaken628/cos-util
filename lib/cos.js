/**
 * Created by michael on 2017/6/19.
 */
const crypto = require('crypto')
const fs = require('fs')
const COS = require('cos-nodejs-sdk-v5')

module.exports = CosUtil

function CosUtil (option) {
  this.cos = new COS(option)
}

CosUtil.prototype.multipartInit = function (params) {
  return new Promise((resolve, reject) => {
    this.cos.multipartInit(params, function (err, result) {
      if (err) { return reject(err) }
      if (!result.UploadId) { return reject(new Error('null UploadId')) }
      resolve(result.UploadId)
    })
  })
}

/**
 *
 * @private
 * @param  {object}   iterator
 * @param  {object}   params
 * @param  {Array}    params.Parts
 * @param  {string}   params.fileSize
 * @param  {string}   params.sliceSize
 * @param  {object}   option
 */
CosUtil.prototype.upload = function (iterator, params, option) {
  let item = iterator.next()
  params.Parts = params.Parts || []
  if (item.done) {
    return Promise.resolve()
  }

  return item.value.then(result => {
    let pg = option.progress.list[result.index - 1]

    if (params.Parts[result.index - 1] &&
      params.Parts[result.index - 1].ETag === '"' + result.hash + '"') {
      console.info('upload: 秒传', result.index, result.hash)
      pg.loaded = pg.total
      option.progress.On()
      return this.upload(iterator, params, option)
    }

    return new Promise((resolve, reject) => {
      this.cos.multipartUpload(Object.assign({
        PartNumber: result.index,
        ContentLength: result.length,
        Body: result.body,
        onProgress: (data) => {
          pg.loaded = data.loaded
          option.progress.On()
        }
        // todo 在sdk更新后换成 ContentMD5
        // ContentSha1: '"' + result.hash + '"'
      }, params), (err, data) => {
        if (err) {
          reject(err)
          return
        }
        // todo do data need be check?
        if (data.ETag === '"' + result.hash + '"') {
          console.info('upload: 分片完成', result.index, result.hash, data)
        } else {
          console.warn('upload: 分片ETag不一致', result.index, result.hash, data)
        }
        if (typeof option.cancel === 'function' && option.cancel()) {
          reject(new Error('upload cancel'))
          return
        }
        params.Parts[result.index - 1] = {
          PartNumber: result.index,
          ETag: data.ETag
        }
        this.upload(iterator, params, option).then(resolve, reject)
      })
    })
  })
}

/**
 * @private
 */
CosUtil.prototype.uploadSlice = function (file, params, option = {}) {
  let iterator = getSliceIterator(file)

  let n = file.fileSize
  option.progress = {list: [], total: file.fileSize}
  while (n > file.sliceSize) {
    option.progress.list.push({total: file.sliceSize})
    n -= file.sliceSize
  }
  option.progress.list.push({total: n})
  if (typeof option.onProgress !== 'function') {
    option.progress.On = () => 0
  } else {
    option.progress.On = () => {
      let loaded = 0
      let total = option.progress.total
      option.progress.list.forEach(obj => (loaded += obj.loaded || 0))
      option.onProgress({
        loaded,
        total,
        percent: loaded / total
      })
    }
  }

  return Promise.all([this.upload(iterator, params, option), this.upload(iterator, params, option)])
    .then(() => {
      return new Promise((resolve, reject) => {
        // todo
        console.log(params)
        this.cos.multipartComplete(params, (err, result) => {
          err ? reject(err) : resolve(result)
        })
      })
    }, (err) => {
      err.params = params
      throw err
    })
}

/**
 *
 * @param  {object}   params
 * @param  {string}   params.Bucket
 * @param  {string}   params.Region
 * @param  {string}   params.Key
 * @param  {string}   params.UploadId 仅续传任务需要
 *
 * @param  {object}   file
 * @param  {string}   file.fileName
 * @param  {int}      file.fileSize
 * @param  {int}      file.sliceSize
 *
 * @param  {object}   option
 * @param  {function} option.onProgress
 * @param  {function} option.cancel
 */
CosUtil.prototype.sliceUploadFile = function (params, file, option = {}) {
  if (params.UploadId) {
    return this.getMultipartListPart(params).then(list => {
      return this.uploadSlice(file, Object.assign(params, {Parts: list}), option)
    })
  }

  return this.multipartInit(params).then((UploadId) => {
    console.info('sliceUploadFile: 创建新上传任务成功，UploadId: ', UploadId)
    params.UploadId = UploadId
    return this.uploadSlice(file, params, option)
  })
}

CosUtil.prototype.getMultipartListPart = function (params) {
  let list = []
  let p = () => new Promise((resolve, reject) => {
    this.cos.multipartListPart(params, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      result.Part.forEach(part => (list[part.PartNumber - 1] = {
        PartNumber: part.PartNumber,
        ETag: part.ETag
      }))
      if (result.IsTruncated === 'true') {
        params.PartNumberMarker = result.NextPartNumberMarker
        p().then(resolve, reject)
        return
      }
      resolve(list)
    })
  })
  return p()
}

CosUtil.prototype.multipartList = function (params) {
  let UploadList = []
  let p = () => new Promise((resolve, reject) => {
    this.cos.multipartList(params, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      UploadList = UploadList.concat(result.Upload || [])
      if (result.IsTruncated === 'true') {
        params.KeyMarker = result.NextKeyMarker
        params.UploadIdMarker = result.NextUploadIdMarker
        return p().then(resolve, reject)
      } else {
        resolve(UploadList)
      }
    })
  })
  return p()
}

CosUtil.prototype.listObject = function (params) {
  let dirs = []
  let objects = []
  params.Delimiter = params.Delimiter || '/'
  let p = () => new Promise((resolve, reject) => {
    this.cos.getBucket(params, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      let pflen = params.Prefix ? params.Prefix.length : 0
      result.CommonPrefixes.forEach(v => {
        if (v.Prefix !== params.Prefix) {
          dirs.push({
            Name: v.Prefix.slice(pflen, -1),
            Prefix: v.Prefix
          })
        }
      })
      result.Contents.forEach(v => objects.push(Object.assign({Name: v.Key.slice(pflen)}, v)))
      if (result.IsTruncated === 'true') {
        params.Marker = result.NextMarker
        return p().then(resolve, reject)
      } else {
        // console.log(dirs, objects);
        resolve({dirs, objects})
      }
    })
  })
  return p()
}

function getSliceMD5 (fileName, index, start, end) {
  // todo 改md5
  let md5 = crypto.createHash('sha1')

  let readStream = fs.createReadStream(fileName, {
    start: start,
    end: end
  })

  return new Promise((resolve, reject) => {
    readStream.on('data', chunk => md5.update(chunk))

    readStream.on('error', reject)

    readStream.on('end', () => resolve({
      index,
      hash: md5.digest('hex'),
      length: end - start + 1,
      body: fs.createReadStream(fileName, {
        start: start,
        end: end
      })
    }))
  })
}

/**
 *
 * @param  {object}   file
 *     @param  {string}   file.fileName
 *     @param  {int}   file.fileSize
 *     @param  {int}   file.sliceSize
 */
function * getSliceIterator (file) {
  let sliceSize = file.sliceSize || 1 << 20
  let start = 0
  let end = sliceSize - 1
  let index = 1

  while (end < file.fileSize - 1) {
    yield getSliceMD5(file.fileName, index, start, end)
    index++
    start = end + 1
    end += sliceSize
  }

  yield getSliceMD5(file.fileName, index, start, file.fileSize - 1)
}
