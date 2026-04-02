const p = await window.electron.fs.openFolder()
console.log('selected:', p)

const root = await window.electron.fs.getWorkspace()
const dir = `${root}/_fs_api_test`
const file = `${dir}/hello.txt`
const moved = `${dir}/hello2.txt`
await window.electron.fs.createFolder(dir)
await window.electron.fs.createFile(file)
await window.electron.fs.writeFile(file, 'boom claw fs api ok')
await window.electron.fs.readFile(file)
await window.electron.fs.rename(file, moved)
await window.electron.fs.readFile(moved)
await window.electron.fs.delete(moved)
await window.electron.fs.delete(dir)


await window.electron.fs.watchStart(root)
const off = window.electron.fs.onChanged((e) => {
  console.log('fs changed:', e)
})

const dir = `${root}/_fs_watch_test`
const file = `${dir}/a.txt`
await window.electron.fs.createFolder(dir)
await window.electron.fs.createFile(file)
await window.electron.fs.writeFile(file, 'watch ok')

await window.electron.fs.delete(file)
await window.electron.fs.delete(dir)
await window.electron.fs.watchStop()
off()


const { useFileSystemStore } = await import('/src/stores/filesystem.ts')

await useFileSystemStore.getState().openFolder()
await useFileSystemStore.getState().refreshTree()
useFileSystemStore.getState().tree

const s = useFileSystemStore.getState()
const root = s.workspacePath
const file = `${root}/_store_test.txt`

await s.createFile(file)
await s.openFile(file)
useFileSystemStore.getState().updateFileContent(file, 'store save ok')
await useFileSystemStore.getState().saveFile(file)
await s.deleteNode(file)