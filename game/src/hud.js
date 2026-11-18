// HUD: health bar, money, wanted stars, objective, speedometer, ammo,
// crosshair, hitmarker, damage vignette, toast and a live 2D minimap.
// The objective sits below the stars so nothing overlaps.
import { CITY } from './config.js';

export function createHUD() {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-fill'),
    money: $('money'),
    stars: $('stars'),
    objective: $('objective-text'),
    objectiveDist: $('objective-dist'),
    missionName: $('mission-name'),
    speed: $('speed'),
    ammo: $('ammo'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    vignette: $('vignette'),
    minimap: $('minimap'),
    toast: $('toast'),
  };
  const mm = els.minimap ? els.minimap.getContext('2d') : null;
  const lastText = {};
  let toastTimer = null;

  function setText(el, key, value) {
    if (!el) return;
    if (lastText[key] !== value) {
      lastText[key] = value;
      el.textContent = value;
    }
  }

  function showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) {
      s.style.display = s.id === 'screen-' + name ? 'flex' : 'none';
    }
  }

  function drawMinimap(d) {
    if (!mm) return;
    const W = 180;
    const H = 180;
    const scale = W / (CITY.size + 40);
    const toX = (x) => (x + CITY.half + 20) * scale;
    const toY = (z) => (z + CITY.half + 20) * scale;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(20, 28, 36, 0.85)';
    mm.fillRect(0, 0, W, H);
    mm.fillStyle = '#2a6a8a';
    mm.fillRect(toX(186), 0, W - toX(186), H);
    mm.strokeStyle = '#6a6e75';
    mm.lineWidth = 3;
    for (const a of CITY.roadAt) {
      mm.beginPath(); mm.moveTo(toX(a), 0); mm.lineTo(toX(a), H); mm.stroke();
      mm.beginPath(); mm.moveTo(0, toY(a)); mm.lineTo(W, toY(a)); mm.stroke();
    }
    if (d.target) {
      mm.fillStyle = '#ffd34a';
      mm.beginPath(); mm.arc(toX(d.target[0]), toY(d.target[1]), 5, 0, Math.PI * 2); mm.fill();
      mm.strokeStyle = '#ffd34a';
      mm.beginPath(); mm.arc(toX(d.target[0]), toY(d.target[1]), 8, 0, Math.PI * 2); mm.stroke();
    }
    mm.fillStyle = '#ff3344';
    for (const p of d.police || []) {
      mm.beginPath(); mm.arc(toX(p.x), toY(p.z), 3, 0, Math.PI * 2); mm.fill();
    }
    const px = toX(d.player.x);
    const py = toY(d.player.z);
    mm.save();
    mm.translate(px, py);
    mm.rotate(Math.PI - d.heading);
    mm.fillStyle = '#ffffff';
    mm.beginPath();
    mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(-4.5, 5); mm.closePath();
    mm.fill();
    mm.restore();
  }

  return {
    showScreen,
    toast(text) {
      if (!els.toast) return;
      els.toast.textContent = text;
      els.toast.style.opacity = '1';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { els.toast.style.opacity = '0'; }, 2600);
    },
    hitmarker() {
      if (!els.hitmarker) return;
      els.hitmarker.style.opacity = '1';
      setTimeout(() => { els.hitmarker.style.opacity = '0'; }, 130);
    },
    damageFlash() {
      if (!els.vignette) return;
      els.vignette.style.opacity = '0.55';
      setTimeout(() => { els.vignette.style.opacity = '0'; }, 180);
    },
    update(s) {
      if (els.health) els.health.style.width = Math.max(0, s.health) + '%';
      setText(els.money, 'money', '$' + s.money);
      const stars = '★'.repeat(s.wanted) + '☆'.repeat(5 - s.wanted);
      setText(els.stars, 'stars', stars);
      setText(els.objective, 'obj', s.objective || '');
      setText(els.objectiveDist, 'objd', s.objectiveDist || '');
      setText(els.missionName, 'mname', s.missionName || '');
      setText(els.speed, 'speed', s.driving ? Math.round(s.speed * 2.23694) + ' mph' : '');
      setText(els.ammo, 'ammo', s.driving ? '' : 'AMMO ' + s.ammo + ' / ' + s.reserve);
      if (els.crosshair) els.crosshair.style.display = s.driving ? 'none' : 'block';
      drawMinimap(s);
    },
  };
}
