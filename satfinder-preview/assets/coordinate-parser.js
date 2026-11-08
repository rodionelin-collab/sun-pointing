/* Coordinate parser from the user's dtk-cords application; local, no requests. */
'use strict';
(() => {
  const NUMBER = '[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)';
  const VALUE = '(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)';
  const decimalPattern = new RegExp(`^(${NUMBER})\\s*°?$`);
  const dmsPattern = new RegExp(`^(${NUMBER})\\s*°\\s*(${VALUE})\\s*'(?:\\s*(${VALUE})\\s*")?$`);

  function normalize(text) {
    return text.normalize('NFKC').toUpperCase()
      .replace(/С\s*\.?\s*Ш\.?/g, 'N').replace(/Ю\s*\.?\s*Ш\.?/g, 'S')
      .replace(/В\s*\.?\s*Д\.?/g, 'E').replace(/З\s*\.?\s*Д\.?/g, 'W')
      .replace(/[−–]/g, '-').replace(/[º˚]/g, '°')
      .replace(/[′’‘`´]/g, "'").replace(/[″“”]/g, '"')
      .replace(/''/g, '"').replace(/\s+/g, ' ').trim();
  }
  function component(raw) {
    let s = raw.trim(), hemisphere = null;
    if (/^[NSEW]/.test(s)) { hemisphere = s[0]; s = s.slice(1).trim(); }
    if (/[NSEW]$/.test(s)) {
      if (hemisphere) return null;
      hemisphere = s.slice(-1); s = s.slice(0, -1).trim();
    }
    const match = s.match(decimalPattern) || s.match(dmsPattern);
    if (!match) return null;
    const degree = Number(match[1].replace(',', '.'));
    const minute = match[2] === undefined ? 0 : Number(match[2].replace(',', '.'));
    const second = match[3] === undefined ? 0 : Number(match[3].replace(',', '.'));
    if (minute >= 60 || second >= 60) throw new Error('Минуты и секунды должны быть меньше 60.');
    if (match[2] !== undefined && !Number.isInteger(degree)) throw new Error('При вводе минут градусы должны быть целыми.');
    if (match[3] !== undefined && !Number.isInteger(minute)) throw new Error('При вводе секунд минуты должны быть целыми.');
    const negative = match[1].startsWith('-'), positive = match[1].startsWith('+');
    if ((negative && /[NE]/.test(hemisphere || '')) || (positive && /[SW]/.test(hemisphere || ''))) {
      throw new Error('Знак числа противоречит полушарию. Используйте минус или S/W для юга и запада.');
    }
    const sign = hemisphere ? (/[SW]/.test(hemisphere) ? -1 : 1) : negative ? -1 : 1;
    return {
      value: sign * (Math.abs(degree) + minute / 60 + second / 3600),
      axis: hemisphere ? (/[NS]/.test(hemisphere) ? 'lat' : 'lon') : null,
      type: match[3] !== undefined ? 'DMS' : match[2] !== undefined ? 'DM' : 'DD'
    };
  }
  function convertCoordinates(input) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('Введите широту и долготу в одно поле.');
    if (input.length > 500) throw new Error('Слишком длинная строка. Введите только одну пару координат.');
    const s = normalize(input), cuts = [];
    if (/[,;]\s*[,;]/.test(s)) throw new Error('Лишний разделитель. Между координатами достаточно одной запятой, пробела или точки с запятой.');
    for (let i = 0; i < s.length; i++) {
      if (/[\s,;]/.test(s[i])) cuts.push([s.slice(0, i), s.slice(i + 1)]);
      if (/[NSEW]/.test(s[i]) && /[+\-\d]/.test(s[i+1] || '')) cuts.push([s.slice(0, i+1), s.slice(i+1)]);
    }
    const results = new Map(), errors = [];
    for (const [left, right] of cuts) {
      try {
        const a = component(left.replace(/[;,]\s*$/, '')), b = component(right.replace(/^\s*[;,]/, ''));
        if (!a || !b) continue;
        let lat, lon;
        if (a.axis && b.axis && a.axis === b.axis) throw new Error('Нужны широта (N/S) и долгота (E/W), а не две координаты одной оси.');
        if (a.axis === 'lon' || b.axis === 'lat') { lat = b; lon = a; }
        else { lat = a; lon = b; }
        if (Math.abs(lat.value) > 90) throw new Error('Широта должна быть от −90 до 90°. Первым числом укажите широту.');
        if (Math.abs(lon.value) > 180) throw new Error('Долгота должна быть от −180 до 180°.');
        const format = value => (Math.abs(value) < 0.0000005 ? 0 : value).toFixed(6);
        const text = `${format(lat.value)}, ${format(lon.value)}`;
        results.set(`${lat.value}|${lon.value}`, {
          latitude: lat.value, longitude: lon.value, text,
          latitudeText: format(lat.value), longitudeText: format(lon.value),
          format: a.type === b.type ? a.type : 'MIX', reordered: a === lon
        });
      } catch (error) { errors.push(error.message); }
    }
    if (results.size === 1) return [...results.values()][0];
    if (results.size > 1) throw new Error('Неоднозначная запись. Разделите широту и долготу точкой с запятой.');
    throw new Error(errors[0] || 'Не удалось распознать пару. Например: 52.842500, 132.791111');
  }
  function formatDMS(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new RangeError('Координаты вне допустимого диапазона.');
    }
    const component = value => {
      // Round the full value first so 60 seconds/minutes carry correctly.
      const total = Math.round(Math.abs(value) * 3600);
      const degree = Math.floor(total / 3600);
      const minute = Math.floor((total % 3600) / 60);
      const second = total % 60;
      return `${degree}°${minute}′${second}″`;
    };
    // Hemisphere letters remain in the decimal readout immediately above.
    return `${component(latitude)} ${component(longitude)}`;
  }
  window.CoordinateConverter = Object.freeze({convert: convertCoordinates, formatDMS});
})();
