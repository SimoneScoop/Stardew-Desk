// electron-builder afterPack hook: put our icon and version info into Stardew Desk.exe.
// (electron-builder does this with rcedit, which needs Windows or Wine; resedit is plain JS.)
'use strict';
const fs = require('fs');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  const data = fs.readFileSync(exe);
  const pe = R.NtExecutable.from(data, { ignoreCert: true });
  const res = R.NtExecutableResource.from(pe);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map(i => i.data));
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0] || R.Resource.VersionInfo.createEmpty();
  const v = ctx.packager.appInfo.version.split('.').map(Number);
  vi.setFileVersion(v[0], v[1], v[2], 0, lang);
  vi.setProductVersion(v[0], v[1], v[2], 0, lang);
  vi.setStringValues({ lang, codepage: 1200 }, {
    FileDescription: 'Stardew Desk', ProductName: 'Stardew Desk', CompanyName: 'SimoneScoop',
    LegalCopyright: 'Code MIT, SimoneScoop. Stardew Valley (c) ConcernedApe; no game assets included.',
    OriginalFilename: 'Stardew Desk.exe', InternalName: 'Stardew Desk',
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • icon and version info set on', path.basename(exe));
};
