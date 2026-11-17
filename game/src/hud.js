// Port Meridian — HUD: DOM readouts and the 160px canvas minimap.
// Layout: the clock sits at the top right and the minimap BELOW it
// (minimap top edge at 60px) so the clock is never covered.
export function makeHud(G) {
  const $ = (id) => document.getElementById(id);
  const hud = {
    minimap: $('minimap'),
    flashT: 0,
    refresh() {
      $('hud-cash').textContent = `$${G.cash}`;
      $('hud-health-fill').style.width = `${Math.max(0, G.player.health)}%`;
      $('hud-health-fill').style.background = G.player.health < 30 ? '#ff4030' : '#40d060';
      const stars = '★'.repeat(G.police.wanted) + '☆'.repeat(5 - G.police.wanted);
      $('hud-stars').textContent = stars;
      $('hud-stars').style.color = G.police.wanted > 0 ? '#ffd34d' : '#ffffff';
      const h = Math.floor(G.timeOfDay);
      const m = Math.floor((G.timeOfDay - h) * 60);
      $('hud-clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      // Mission tracker.
      const mt = $('mission-tracker');
      if (G.missions.done) {
        mt.innerHTML = '<b>Story complete</b><br>Mara is free. Free roam!';
      } else {
        const mi = G.missions.current();
        const st = G.missions.stageDef();
        let extra = '';
        if (st?.kind === 'escape' || st?.kind === 'race') extra = ` — ${Math.ceil(G.missions.stageTimer)}s`;
        mt.innerHTML = `<b>${mi.name}</b> — $${mi.reward}<br>${st ? st.text : ''}${extra}<br><i>${mi.dialogue}</i>`;
      }
      // Side activity line.
      const lines = [];
      const ft = G.side.fareText();
      if (ft) lines.push(ft);
      lines.push(`TOKENS ${G.side.tokensCollected}/12`);
      if (G.side.courier) {
        const c = G.side.courier;
        lines.push(c.pickedUp ? `COURIER: deliver it — ${Math.ceil(c.timer)}s` : `COURIER: pick up the package — ${Math.ceil(c.timer)}s`);
      }
      $('side-line').textContent = lines.join(' · ');
      // Driving readout.
      const drv = $('drive-panel');
      if (G.player.car) {
        drv.style.display = 'block';
        $('speedo').textContent = `${Math.round(Math.abs(G.player.car.speed) * 3.6)} km/h`;
        $('car-name').textContent = G.player.car.name;
        $('car-health').textContent = `Car ${Math.max(0, Math.round(G.player.car.health))}%`;
      } else {
        drv.style.display = 'none';
      }
      // Weapon readout.
      $('ammo').textContent = G.player.aiming ? `◉ ${G.player.ammo}/${G.player.reserve}` : `Pistol ${G.player.ammo}/${G.player.reserve}`;
      $('crosshair').style.display = G.player.aiming ? 'block' : 'none';
    },
    message(text) {
      const el = $('center-msg');
      el.textContent = text;
      el.style.opacity = '1';
      clearTimeout(this._msgTimer);
      this._msgTimer = setTimeout(() => { el.style.opacity = '0'; }, 3200);
    },
    toast(text) {
      const el = $('objective-toast');
      el.textContent = text;
      el.style.opacity = '1';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 4000);
    },
    flashDamage() {
      $('vignette').style.opacity = '0.55';
      clearTimeout(this._vigTimer);
      this._vigTimer = setTimeout(() => { $('vignette').style.opacity = G.player.health < 30 ? '0.4' : '0'; }, 180);
    },
    drawMinimap() {
      const c = this.minimap;
      if (!c) return;
      const ctx = c.getContext('2d');
      const S = c.width; // 160
      const scale = S / 480;
      const toX = (x) => (x + 240) * scale;
      const toZ = (z) => (z + 240) * scale;
      ctx.fillStyle = '#2a2f38';
      ctx.fillRect(0, 0, S, S);
      // Water strip at the south edge.
      ctx.fillStyle = '#2f7fa8';
      ctx.fillRect(0, toZ(200), S, S - toZ(200));
      // Roads.
      ctx.fillStyle = '#565b66';
      for (let i = -240; i <= 240; i += 60) {
        ctx.fillRect(toX(i) - 1.5, 0, 3, S);
        ctx.fillRect(0, toZ(i) - 1.5, S, 3);
      }
      // Mission marker (pulsing gold dot).
      if (G.missions.target) {
        const p = 1 + Math.sin(performance.now() / 200) * 0.4;
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath();
        ctx.arc(toX(G.missions.target.x), toZ(G.missions.target.z), 3.5 * p, 0, Math.PI * 2);
        ctx.fill();
      }
      // Taxi fare.
      if (G.side.fare) {
        ctx.fillStyle = '#37e0ff';
        ctx.beginPath();
        ctx.arc(toX(G.side.fare.x), toZ(G.side.fare.z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Tokens.
      ctx.fillStyle = '#ffd34d';
      for (const tok of G.side.tokens) {
        if (tok.taken) continue;
        ctx.fillRect(toX(tok.x) - 1.5, toZ(tok.z) - 1.5, 3, 3);
      }
      // Traffic as pale dots, police as blue dots, pedestrians as small dots.
      ctx.fillStyle = '#cfd4da';
      for (const car of G.traffic.cars) ctx.fillRect(toX(car.x) - 1, toZ(car.z) - 1, 2, 2);
      ctx.fillStyle = '#c8a0a0';
      for (const p of G.pedestrians.peds) {
        if (p.alive) ctx.fillRect(toX(p.x) - 1, toZ(p.z) - 1, 2, 2);
      }
      ctx.fillStyle = '#4080ff';
      for (const car of G.police.cars) {
        ctx.beginPath();
        ctx.arc(toX(car.x), toZ(car.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Player: white dot with a heading tick.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(toX(G.player.x), toZ(G.player.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(toX(G.player.x), toZ(G.player.z));
      ctx.lineTo(
        toX(G.player.x) + Math.sin(G.player.heading) * 8,
        toZ(G.player.z) + Math.cos(G.player.heading) * 8
      );
      ctx.stroke();
    },
  };
  return hud;
}
