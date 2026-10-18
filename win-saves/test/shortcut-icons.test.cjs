const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {iconLocation,iconCandidates,shortcutText}=require('../shortcut-icons.cjs');
test('icon locations retain DLL resource IDs, quoted paths and commas',()=>{
 assert.deepEqual(iconLocation('"C:/Apps/Tools, Inc/icons.dll", -42'),{file:'C:/Apps/Tools, Inc/icons.dll',index:-42});
 assert.deepEqual(iconLocation('C:/Icons/game.ico',3),{file:'C:/Icons/game.ico',index:3});
 assert.equal(iconLocation(''),null);assert.equal(iconLocation('C:/Icons/game.ico',Infinity).index,0);
});
test('shortcut text supports UTF-8 and UTF-16 Windows encodings',()=>{
 const text='[InternetShortcut]\r\nIconFile=C:/游戏/图标.ico\r\n';
 const le=Buffer.from(text,'utf16le'),be=Buffer.from(le).swap16();
 for(const bytes of [Buffer.from('\uFEFF'+text),Buffer.concat([Buffer.from([255,254]),le]),Buffer.concat([Buffer.from([254,255]),be])])assert.equal(shortcutText(bytes),text);
});
test('explicit icon resources precede target fallback and URL icon indices survive',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stardew-icon-test-'));
 try{const ico=path.join(root,'custom, game.ico'),exe=path.join(root,'app.exe'),link=path.join(root,'game.url');fs.writeFileSync(ico,'fixture');fs.writeFileSync(exe,'fixture');
 const raw='[InternetShortcut]\r\nURL=steam://rungameid/1\r\nIconFile='+ico+'\r\nIconIndex=7\r\n';fs.writeFileSync(link,Buffer.concat([Buffer.from([255,254]),Buffer.from(raw,'utf16le')]));
 assert.deepEqual(iconCandidates({file:link,extension:'.url'}),[{file:ico,index:7}]);
 const item={file:path.join(root,'game.lnk'),extension:'.lnk'};assert.deepEqual(iconCandidates(item,{[item.file]:{icon:'"'+ico+'",-2',target:exe}}),[{file:ico,index:-2},{file:exe,index:0}]);
 fs.unlinkSync(ico);assert.deepEqual(iconCandidates(item,{[item.file]:{icon:ico+',0',target:exe}}),[{file:exe,index:0}]);
 }finally{fs.rmSync(root,{recursive:true});}
});
