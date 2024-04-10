import { basename, join, resolve } from 'path'
import { copyFile, readFile, readdir, writeFile } from 'fs/promises'
import { constants, emptyDirSync, move, remove } from 'fs-extra'
import { glob } from 'glob'
import { run } from './utils/process'
import { sequential } from './utils/promises'
import { createDirectory, isDirectory, isFile, isFileOfType } from './utils/fs'

const PATH_LIB_MBINCOMPILER = resolve('lib/MBINCompiler/Build/Release/net7.0/linux-x64/MBINCompiler')
const PATH_LIB_PSARC = resolve('lib/psarc/bin/rls/psarc')
const PATH_LIB_PSARCPACKER = resolve('lib/psarcpacker/psarc.exe')
const PATH_MODS = resolve('mods')
const PATH_OUTPUT = resolve('output')
const PATH_STEAM_LIBRARIES = resolve(join(process.env.HOME, '.steam', 'root', 'config', 'libraryfolders.vdf'))
const PATH_TMP_BANKS = resolve('.banks')
const PATH_TMP_EXTRACT = resolve('.extract')
const PATH_TMP_MERGE = resolve('.merge')

const REGEX_STEAM_LIBRARY = /"path"\s*"(.+)"/g
const REGEX_BANK_CONTENT = /^(\d+)\s+\d*.?\d+\s[b]?[Kb]?[Mb]?[Gb]?\s(\S+)/

const FILES = {} as Record<string, { bank: string, id: number, extracted: boolean }>

const CONFIG = {
  game: null as string,
  git: null as string,
  mbincompiler: null as string,
  mono: null as string,
  psarc: null as string,
  psarcpacker: null as string,
  wine: null as string,
}

const prepareGame = async () => {
  console.log(`[INIT] Resolving steam libraries in ${PATH_STEAM_LIBRARIES}...`)
  try {
    const buffer = await readFile(PATH_STEAM_LIBRARIES, 'utf8')
    const libraries = Array.from(buffer.toString().matchAll(REGEX_STEAM_LIBRARY)).map((match) => match[1])

    CONFIG.game = libraries.reduce((game, library) => {
      const attempt = join(library, 'steamapps', 'common', 'No Man\'s Sky', 'GAMEDATA', 'PCBANKS')

      return isDirectory(attempt) ? attempt : game
    }, null)

    console.log(`[INIT] Found game at ${CONFIG.game}.`)
  } catch (error) {
    console.error(`[INIT] Cannot read steam libraries, aborting.\n${(error as Error).stack}`)
  }
}

const prepareGit = async () => {
  console.log('[INIT] Resolving git...')
  try {
    CONFIG.git = await run('which', ['git'])

    console.log(`[INIT] Found git at ${CONFIG.git}.`)
  } catch (error) {
    console.error(`[INIT] Cannot find git, aborting.\n${(error as Error).stack}`)
  }
}

const prepareMBINCompiler = async () => {
  console.log('[INIT] Resolving MBINCompiler...')
  try {
    CONFIG.mbincompiler = isFile(PATH_LIB_MBINCOMPILER) && PATH_LIB_MBINCOMPILER

    console.log(`[INIT] Found MBINCompiler at ${CONFIG.mbincompiler}.`)
  } catch (error) {
    console.error(`[INIT] Cannot find MBINCompiler at ${PATH_LIB_MBINCOMPILER}, aborting.\n${(error as Error).stack}`)
  }
}

const prepareMono = async () => {
  console.log('[INIT] Resolving mono...')
  try {
    CONFIG.mono = await run('which', ['mono'])

    console.log(`[INIT] Found mono at ${CONFIG.mono}.`)
  } catch (error) {
    console.error(`[INIT] Cannot find mono, aborting.\n${(error as Error).stack}`)
  }
}

const preparePsarc = async () => {
  console.log('[INIT] Resolving psarc...')
  try {
    CONFIG.psarc = isFile(PATH_LIB_PSARC) && PATH_LIB_PSARC

    console.log(`[INIT] Found psarc at ${CONFIG.psarc}.`)
  } catch (error) {
    console.error(`[INIT] Cannot find psarc at ${PATH_LIB_PSARC}, aborting.\n${(error as Error).stack}`)
  }
}

const preparePsarcPacker = async () => {
  console.log('[INIT] Resolving psarc (packer)...')
  try {
    CONFIG.psarcpacker = isFile(PATH_LIB_PSARCPACKER) && PATH_LIB_PSARCPACKER

    console.log(`[INIT] Found psarc (packer) at ${CONFIG.psarcpacker}.`)
  } catch (error) {
    console.error(`[INIT] Cannot find psarc (packer) at ${PATH_LIB_PSARCPACKER}, aborting.\n${(error as Error).stack}`)
  }
}

const prepareWine = async () => {
  console.log('[INIT] Resolving wine...')
  try {
    CONFIG.wine = await run('which', ['wine'])

    console.log(`[INIT] Found wine at ${CONFIG.wine}.`)
  } catch (error) {
    console.error(`[INIT] Cannot find wine, aborting.\n${(error as Error).stack}`)
  }
}

const retrieveBanks = async () => {
  console.log('[TASK] Retrieving content...')
  try {
    await createDirectory(PATH_TMP_BANKS)

    const banks = await glob(join(CONFIG.game, '*.pak'))

    await sequential(banks, async (bank) => {
      const bankName = `${basename(bank)}.txt`
      const bankNameInStorage = join(PATH_TMP_BANKS, bankName)
      const bankNameInGame = resolve(CONFIG.game, bank)

      if (isFile(bankNameInStorage)) {
        console.log(`\tFound ${bankName} bank.`)
      } else {
        console.log(`\tRetrieving ${bank} bank...`)
        await run(CONFIG.psarc, ['-l', bankNameInGame], { cwd: PATH_TMP_BANKS })
      }

      const content = await readFile(bankNameInStorage, 'utf8')
      const contentMatch = content.split('\n').filter(Boolean).map((line) => line.match(REGEX_BANK_CONTENT))

      contentMatch.forEach((match) => {
        FILES[match[2]] = { bank: bankNameInGame, id: parseInt(match[1]), extracted: false }
      })
    })
  } catch (error) {
    console.error(`[ERROR] Encountered an error while listing game files.\n${(error as Error).stack}`)
  }
}

const extractFromBank = async (bank: string, id: number) => {
  console.log(`\t\tExtracting ${bank} at ${id} from game files...`)
  await run(CONFIG.psarc, ['-e', id.toString(), id.toString(), bank], { cwd: PATH_TMP_MERGE })

  const source = join(PATH_TMP_MERGE, `${basename(bank)}_data`)
  const files = await glob(join(source, '**/*'), { nodir: true })
  await sequential(files, async (file) => {
    const target = join(PATH_TMP_MERGE, file.substring(source.length + 1))
    await move(file, target)
    await run(CONFIG.mbincompiler, [target])
    await remove(target)
  })

  await remove(source)
}

const extractMod = async (mod: string) => {
  console.log(`\tExtracting ${mod}...`)
  try {
    const source = join(PATH_MODS, mod)
    const target = join(PATH_TMP_EXTRACT, mod)
    const targetOutput = join(PATH_TMP_EXTRACT, `${mod}_data`)

    await copyFile(source, target, constants.COPYFILE_FICLONE)
    await run(CONFIG.psarc, ['-x', resolve(target)], { cwd: PATH_TMP_EXTRACT })

    const mbins = await glob(join(targetOutput, '**/*.MBIN'), { maxDepth: 255 })

    await sequential(mbins, async (mbin) => {
      const file = FILES[mbin.substring(targetOutput.length + 1)]

      if (!file.extracted) {
        await extractFromBank(file.bank, file.id)
        file.extracted = true
      }

      await run(CONFIG.mbincompiler, [mbin], { cwd: PATH_TMP_EXTRACT })
    })

    await Promise.all([target, ...await glob(join(targetOutput, '*.txt')), ...mbins].map((residual) => remove(residual)))
  } catch (error) {
    console.error(`[ERROR] Encountered an error while extracting ${mod}.\n${(error as Error).stack}`)
  }
}

const extract = async () => {
  console.log('[TASK] Extracting mods...')
  try {
    emptyDirSync(PATH_TMP_EXTRACT)
    emptyDirSync(PATH_TMP_MERGE)

    const mods = await readdir(PATH_MODS, { recursive: false })
    const modsPak = mods.map((mod) => mod.toString()).filter((mod) => isFileOfType(join(PATH_MODS, mod), '.pak'))

    await sequential(modsPak, async (mod) => extractMod(mod))
  } catch (error) {
    console.error(`[ERROR] Encountered an error while copying mods.\n${(error as Error).stack}`)
  }
}

const mergeMod = async (mod: string) => {
  const modName = mod.substring(0, mod.lastIndexOf('.pak_data'))

  console.log(`\tMerging ${modName}...`)
  try {
    const root = await run('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: PATH_TMP_MERGE })
    await run('git', ['checkout', root], { cwd: PATH_TMP_MERGE })

    const modDirectory = join(PATH_TMP_EXTRACT, mod)
    const modFiles = await glob(join(modDirectory, '**/*'), { nodir: true })

    await sequential(modFiles, async (source) => {
      const destination = join(PATH_TMP_MERGE, source)
      await move(source, destination, { overwrite: true })
    })

    await run('git', ['add', '.'], { cwd: PATH_TMP_MERGE })
    await run('git', ['commit', '-m', modName], { cwd: PATH_TMP_MERGE })
    await run('git', ['checkout', '-b', modName.replaceAll(' ', '_')], { cwd: PATH_TMP_MERGE })
    await run('git', ['rebase', 'merge'], { cwd: PATH_TMP_MERGE })
    await run('git', ['branch', '-f', 'merge'], { cwd: PATH_TMP_MERGE })
  } catch (error) {
    console.error(`[ERROR] Encountered an error while merging mod ${modName}.\n${(error as Error).stack}`)
  }
}

const merge = async () => {
  console.log('[TASK] Merging mods...')
  try {
    await run('git', ['init'], { cwd: PATH_TMP_MERGE })
    await run('git', ['add', '.'], { cwd: PATH_TMP_MERGE })
    await run('git', ['commit', '-m', 'base'], { cwd: PATH_TMP_MERGE })
    await run('git', ['checkout', '-b', 'merge'], { cwd: PATH_TMP_MERGE })

    const mods = await readdir(PATH_TMP_EXTRACT, { recursive: false })

    await sequential(mods, async (mod) => mergeMod(mod))
  } catch (error) {
    console.error(`[ERROR] Encountered an error while merging mods.\n${(error as Error).stack}`)
  }
}

const pack = async () => {
  console.log('[TASK] Packing mods...')
  try {
    emptyDirSync(PATH_OUTPUT)
    createDirectory(PATH_OUTPUT)

    const list = [] as string[]

    const files = await glob(join(PATH_TMP_MERGE, '**/*'), { nodir: true })
    await sequential(files, async (file) => {
      if (file.endsWith('.EXML')) {
        await run(CONFIG.mbincompiler, [file], { cwd: PATH_TMP_MERGE })
        await remove(file)

        list.push(file.replace(`${PATH_TMP_MERGE}/`, '').replace('.EXML', '.MBIN'))
      } else {
        list.push(file.replace(`${PATH_TMP_MERGE}/`, ''))
      }
    })

    const input = join(PATH_OUTPUT, 'mods.txt')
    await writeFile(input, list.join('\n'))

    const output = join(PATH_OUTPUT, 'merged.pak')
    await run(CONFIG.wine, [CONFIG.psarcpacker, 'create', '-a', '--zlib', `--inputfile=${input}`, `--output=${output}`], { cwd: PATH_TMP_MERGE })
  } catch (error) {
    console.error(`[ERROR] Encountered an error while packing mods.\n${(error as Error).stack}`)
  }
}

const clean = async () => {
  emptyDirSync(PATH_TMP_EXTRACT)
  emptyDirSync(PATH_TMP_MERGE)
}

const main = async () => {
  await prepareGame()
  await prepareGit()
  await prepareMBINCompiler()
  await prepareMono()
  await preparePsarc()
  await preparePsarcPacker()
  await prepareWine()

  await retrieveBanks()

  await extract()
  await merge()
  await pack()
  await clean()
}

main()
