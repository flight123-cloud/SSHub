// SSHub 官网：下载链接指向最新版本、复制命令、截图放大、滚动淡入
;(function () {
  'use strict'

  var REPO = 'flight123-cloud/SSHub'
  var ZH = (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0
  var T = ZH
    ? { latest: '最新版本 ', copy: '复制', copied: '已复制', mb: ' MB' }
    : { latest: 'Latest version ', copy: 'Copy', copied: 'Copied', mb: ' MB' }

  /* ---------- 记住访客选择的语言 ---------- */
  document.querySelectorAll('[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () {
      try {
        localStorage.setItem('sshub-lang', a.getAttribute('data-lang'))
      } catch (e) {}
    })
  })

  /* ---------- 最新版本的下载链接 ---------- */
  function applyRelease(rel) {
    if (!rel || !rel.assets) return
    var pick = function (arch) {
      // 优先 dmg，没有时用 zip
      var dmg = rel.assets.find(function (a) { return a.name.indexOf('-' + arch + '.dmg') !== -1 })
      var zip = rel.assets.find(function (a) { return a.name.indexOf('-' + arch + '.zip') !== -1 })
      return dmg || zip
    }
    document.querySelectorAll('.dl-link').forEach(function (el) {
      var asset = pick(el.getAttribute('data-arch'))
      if (asset) {
        el.href = asset.browser_download_url
        el.title = asset.name + ' (' + (asset.size / 1048576).toFixed(0) + T.mb + ')'
      }
    })
    var v = document.getElementById('version')
    if (v && rel.tag_name) {
      var date = rel.published_at ? new Date(rel.published_at) : null
      var d = date ? date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') : ''
      v.textContent = T.latest + rel.tag_name + (d ? (ZH ? '（' + d + '）' : ' (' + d + ')') : '')
    }
  }

  try {
    var cached = sessionStorage.getItem('sshub-release')
    if (cached) applyRelease(JSON.parse(cached))
  } catch (e) {}

  if (window.fetch) {
    fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (rel) {
        if (!rel) return
        applyRelease(rel)
        try {
          sessionStorage.setItem('sshub-release', JSON.stringify({ tag_name: rel.tag_name, published_at: rel.published_at, assets: rel.assets.map(function (a) { return { name: a.name, size: a.size, browser_download_url: a.browser_download_url } }) }))
        } catch (e) {}
      })
      .catch(function () {
        /* 接口不可用时，按钮保持指向 Releases 页面 */
      })
  }

  /* ---------- Intel Mac：把 Intel 版按钮放到前面 ---------- */
  var uad = navigator.userAgentData
  if (uad && uad.getHighEntropyValues) {
    uad.getHighEntropyValues(['architecture']).then(function (v) {
      if (v.architecture === 'x86') {
        document.querySelectorAll('.cta').forEach(function (cta) {
          var x = cta.querySelector('[data-arch="x64"]')
          var a = cta.querySelector('[data-arch="arm64"]')
          if (x && a) {
            x.classList.replace('btn-ghost', 'btn-primary')
            a.classList.replace('btn-primary', 'btn-ghost')
            cta.insertBefore(x, a)
          }
        })
      }
    }).catch(function () {})
  }

  /* ---------- 复制命令 ---------- */
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = document.querySelector(btn.getAttribute('data-copy'))
      if (!src || !navigator.clipboard) return
      navigator.clipboard.writeText(src.textContent.trim()).then(function () {
        btn.textContent = T.copied
        btn.classList.add('done')
        setTimeout(function () {
          btn.textContent = T.copy
          btn.classList.remove('done')
        }, 1600)
      })
    })
  })

  /* ---------- 截图放大 ---------- */
  var box = document.getElementById('lightbox')
  var boxImg = box.querySelector('img')
  var close = function () {
    box.hidden = true
    boxImg.removeAttribute('src')
    document.body.style.overflow = ''
  }
  document.querySelectorAll('.shot img').forEach(function (img) {
    img.addEventListener('click', function () {
      boxImg.src = img.currentSrc || img.src
      boxImg.alt = img.alt
      box.hidden = false
      document.body.style.overflow = 'hidden'
    })
  })
  box.addEventListener('click', close)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !box.hidden) close()
  })

  /* ---------- 滚动淡入 ---------- */
  if ('IntersectionObserver' in window) {
    var targets = document.querySelectorAll('.card, .feature-inner > *, .security > *, .more, .steps li, .shot-quick')
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('visible')
            io.unobserve(en.target)
          }
        })
      },
      { rootMargin: '0px 0px -8% 0px' }
    )
    targets.forEach(function (t) {
      t.classList.add('reveal')
      io.observe(t)
    })
  }
})()
