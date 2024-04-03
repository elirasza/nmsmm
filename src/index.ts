import { basename, join, resolve } from 'path'
import { copyFile, readFile, readdir } from 'fs/promises'
import { constants, emptyDirSync, move, remove } from 'fs-extra'
import { glob } from 'glob'
import { run } from './utils/process'
import { sequential } from './utils/promises'
import { createDirectory, isDirectory, isFile, isFileOfType } from './utils/fs'

const PATH_LIB_MBINCOMPILER = resolve('lib/MBINCompiler/Build/Release/net7.0/linux-x64/MBINCompiler')
const PATH_LIB_PSARC = resolve('lib/psarc/bin/rls/psarc')
const PATH_MODS = resolve('mods')
const PATH_PLAN = resolve('.plan')
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
  psarc: null as string,
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

const preparePsarc = async () => {
  console.log('[INIT] Resolving psarc...')
  try {
    CONFIG.psarc = isFile(PATH_LIB_PSARC) && PATH_LIB_PSARC

    console.log(`[INIT] Found psarc at ${CONFIG.psarc}.`)
  } catch (error) {
    console.error(`[INIT] Cannot find psarc at ${PATH_LIB_PSARC}, aborting.\n${(error as Error).stack}`)
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
        console.log(`\t[TASK] Found ${bankName} bank.`)
      } else {
        console.log(`\t[TASK] Retrieving ${bank} bank...`)
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
  console.log(`[TASK] Extracting ${bank} from game files...`)
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
  console.log(`[TASK] Extracting ${mod}...`)
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

      await run(CONFIG.mbincompiler, [mbin])
    })

    await Promise.all([target, ...await glob(join(targetOutput, '*.txt')), ...mbins].map((residual) => remove(residual)))
  } catch (error) {
    console.error(`[ERROR] Encountered an error while extracting ${mod}.\n${(error as Error).stack}`)
  }
}

const extract = async () => {
  console.log('[TASK] Extracting mods to extraction directory...')
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

const merge = async () => {
  console.log('[TASK] Merging mods...')
  try {
    console.log('PLACEHOLDER')
  } catch (error) {
    console.error(`[ERROR] Encountered an error while merging mods.\n${(error as Error).stack}`)
  }
}

const main = async () => {
  await remove(PATH_PLAN)

  await prepareGame()
  await prepareGit()
  await prepareMBINCompiler()
  await preparePsarc()
  await prepareWine()

  await retrieveBanks()

  await extract()
  await merge()
}

main()
