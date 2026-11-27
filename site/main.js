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
    var find = function (suffix) {
      return rel.assets.find(function (a) { return a.name.slice(-suffix.length) === suffix })
    }
    // macOS：优先 dmg，没有时用 zip；Windows：安装程序（-setup.exe）或免安装 zip
    var pick = function (os, arch, kind) {
      if (os === 'win') return kind === 'zip' ? find('-win-' + arch + '.zip') : find('-win-' + arch + '-setup.exe')
      return find('-mac-' + arch + '.dmg') || find('-mac-' + arch + '.zip')
    }
    document.querySelectorAll('.dl-link').forEach(function (el) {
      var asset = pick(el.getAttribute('data-os') || 'mac', el.getAttribute('data-arch'), el.getAttribute('data-kind'))
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

  /* ---------- 按访客系统显示 macOS 或 Windows 的下载按钮 ---------- */
  var isWindows = /Windows/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent)
  function showOS(os) {
    document.querySelectorAll('.cta[data-os]').forEach(function (el) {
      el.hidden = el.getAttribute('data-os') !== os
    })
    document.querySelectorAll('[data-show-os]').forEach(function (a) {
      a.hidden = a.getAttribute('data-show-os') === os
    })
  }
  showOS(isWindows ? 'win' : 'mac')
  document.querySelectorAll('[data-show-os]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault()
      showOS(a.getAttribute('data-show-os'))
    })
  })

  /* ---------- Intel Mac：把 Intel 版按钮放到前面 ---------- */
  var uad = navigator.userAgentData
  if (uad && uad.getHighEntropyValues) {
    uad.getHighEntropyValues(['architecture']).then(function (v) {
      if (v.architecture === 'x86' && !isWindows) {
        document.querySelectorAll('.cta[data-os="mac"]').forEach(function (cta) {
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

  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var HOVER = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches

  /* ---------- 常见问题：平滑展开 / 收起，每个问题可直接链接 ---------- */
  var faqs = Array.prototype.slice.call(document.querySelectorAll('#faq details'))
  function setFaq(d, open, instant) {
    var body = d.querySelector('.faq-body')
    if (d._anim) {
      var from = body.getBoundingClientRect().height
      d._anim.cancel()
      d._anim = null
    }
    d.classList.toggle('is-open', open)
    if (REDUCE || instant || !body.animate) {
      d.open = open
      return
    }
    if (open) {
      d.open = true
      var to = body.scrollHeight
      d._anim = body.animate(
        [
          { height: (from || 0) + 'px', opacity: from ? 1 : 0, transform: from ? 'none' : 'translateY(-6px)' },
          { height: to + 'px', opacity: 1, transform: 'none' }
        ],
        { duration: 340, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      )
    } else {
      var h = from || body.offsetHeight
      d._anim = body.animate(
        [
          { height: h + 'px', opacity: 1 },
          { height: '0px', opacity: 0 }
        ],
        { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
      )
    }
    var anim = d._anim
    anim.onfinish = function () {
      if (d._anim !== anim) return
      d._anim = null
      if (!open) d.open = false
    }
  }
  faqs.forEach(function (d, i) {
    var s = d.querySelector('summary')
    var body = document.createElement('div')
    body.className = 'faq-body'
    while (s.nextSibling) body.appendChild(s.nextSibling)
    d.appendChild(body)
    if (!d.id) d.id = 'faq-' + (i + 1)
    if (d.open) d.classList.add('is-open')
    s.addEventListener('click', function (e) {
      e.preventDefault()
      var open = !d.classList.contains('is-open')
      setFaq(d, open)
      if (open && history.replaceState) history.replaceState(null, '', '#' + d.id)
    })
  })
  function openFromHash() {
    var d = location.hash && document.getElementById(location.hash.slice(1))
    if (d && faqs.indexOf(d) >= 0) {
      setFaq(d, true, true)
      d.scrollIntoView({ block: 'center' })
    }
  }
  openFromHash()
  window.addEventListener('hashchange', openFromHash)

  /* ---------- 跟随鼠标的光晕边框 ---------- */
  if (HOVER && !REDUCE) {
    var glowGroups = document.querySelectorAll('.grid-6, #faq .container')
    glowGroups.forEach(function (group) {
      var items = group.querySelectorAll('.card, details')
      items.forEach(function (el) {
        el.classList.add('glow')
      })
      var raf = 0
      var last = null
      group.addEventListener('pointermove', function (e) {
        last = e
        if (raf) return
        raf = requestAnimationFrame(function () {
          raf = 0
          items.forEach(function (el) {
            var r = el.getBoundingClientRect()
            el.style.setProperty('--mx', last.clientX - r.left + 'px')
            el.style.setProperty('--my', last.clientY - r.top + 'px')
          })
        })
      })
      group.addEventListener('pointerenter', function () { group.classList.add('glow-on') })
      group.addEventListener('pointerleave', function () { group.classList.remove('glow-on') })
    })
  }

  /* ---------- 首屏截图：随滚动放平、随鼠标微倾 ---------- */
  var heroWin = document.querySelector('.shot-hero .window')
  var heroTilt = { rx: 4, ry: 0 }
  function applyTilt() {
    heroWin.style.setProperty('--rx', heroTilt.rx.toFixed(2) + 'deg')
    heroWin.style.setProperty('--ry', heroTilt.ry.toFixed(2) + 'deg')
  }

  /* ---------- 导航：阅读进度条 + 当前区块高亮 ---------- */
  var nav = document.querySelector('.nav')
  var ticking = false
  function onScroll() {
    ticking = false
    var max = document.documentElement.scrollHeight - innerHeight
    nav.style.setProperty('--progress', max > 0 ? Math.min(1, scrollY / max).toFixed(4) : 0)
    if (heroWin && !REDUCE) {
      var r = heroWin.getBoundingClientRect()
      // 截图顶部从视口底部移到视口 35% 处的过程中，倾斜从 4° 变为 0°
      var t = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.65)))
      heroTilt.rx = 4 * (1 - t)
      applyTilt()
    }
  }
  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true
      requestAnimationFrame(onScroll)
    }
  }, { passive: true })
  onScroll()

  if (heroWin && HOVER && !REDUCE) {
    var hero = document.querySelector('.hero')
    hero.addEventListener('pointermove', function (e) {
      var r = heroWin.getBoundingClientRect()
      heroTilt.ry = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2))) * 2.5
      applyTilt()
    })
    hero.addEventListener('pointerleave', function () {
      heroTilt.ry = 0
      applyTilt()
    })
  }

  var links = {}
  document.querySelectorAll('.nav-links a[href^="#"]').forEach(function (a) {
    links[a.getAttribute('href').slice(1)] = a
  })
  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          var a = links[en.target.id]
          if (a) a.classList.toggle('active', en.isIntersecting)
        })
      },
      { rootMargin: '-45% 0px -50% 0px' }
    )
    Object.keys(links).forEach(function (id) {
      var sec = document.getElementById(id)
      if (sec) spy.observe(sec)
    })
  }

  /* ---------- 滚动淡入（同一组内依次出现） ---------- */
  if ('IntersectionObserver' in window && !REDUCE) {
    var targets = document.querySelectorAll('.card, .feature-inner > *, .security > *, .more, .steps li, .shot-quick, #faq details')
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var el = en.target
            el.classList.add('visible')
            io.unobserve(el)
            // 出现后清掉延迟，避免影响悬停动效
            setTimeout(function () { el.style.transitionDelay = '' }, 900)
          }
        })
      },
      { rootMargin: '0px 0px -8% 0px' }
    )
    targets.forEach(function (t) {
      var sibs = Array.prototype.filter.call(t.parentNode.children, function (c) { return c.tagName === t.tagName })
      var i = sibs.indexOf(t)
      if (i > 0) t.style.transitionDelay = Math.min(i, 6) * 70 + 'ms'
      t.classList.add('reveal')
      io.observe(t)
    })
  }
})()
