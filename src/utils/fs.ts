import { statSync } from 'fs'
import { mkdir } from 'fs/promises'

export const isFile = (file: string) => statSync(file, { throwIfNoEntry: false })?.isFile()

export const isFileOfType = (file: string, type: string) => file.endsWith(type) && isFile(file)

export const isDirectory = (directory: string) => statSync(directory, { throwIfNoEntry: false })?.isDirectory()

export const createDirectory = async (directory: string) => isDirectory(directory) || await mkdir(directory)
