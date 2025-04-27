import 'cheerio'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import ora from 'ora'
import chalk from 'chalk'

//?? Document Preparation using Langchain
async function main(type, web_url, question) {
   let allSplits
   //~ Document Fetching, creating Chunks using LANGCHAIN
   const spinnerIndex = ora('Document Preparation...\n').start()
   let docs
   try {
      if (type === 'web') {
         const pTagSelector = 'p'
         const cheerioLoader = new CheerioWebBaseLoader(web_url, {
            selector: pTagSelector,
         })

         docs = await cheerioLoader.load()
      } else if (type === 'pdf') {
         const loader = new PDFLoader(web_url)
         docs = await loader.load()
      } else if (type === 'text') {
         docs = [
            {
               pageContent: web_url,
               metadata: { source: 'text' },
            },
         ]
      }
      console.log('docs :', docs)
      const splitter = new RecursiveCharacterTextSplitter({
         chunkSize: 1000,
         chunkOverlap: 200,
      })

      allSplits = await splitter.splitDocuments(docs)
      console.log('\nallSplits :', allSplits)
      spinnerIndex.succeed('Document Preparation Done')
   } catch (err) {
      console.error('Error during document loading:', err)
      spinnerIndex.fail('Document Preparation Failed')
      return
   }
}

//?? MAIN FUNCTION CALL
const rl = readline.createInterface({ input, output })
const type = await rl.question(
   chalk.bold.blue`\nEnter the type of Data source (web or pdf or text): `
)
const typeContent =
   type === 'web'
      ? 'URL for web page: '
      : type === 'pdf'
      ? 'PDF file path: '
      : 'Text: '
const web_url = await rl.question(chalk.bold.blue`\nEnter ${typeContent} `)
const question = await rl.question(chalk.bold.blue`\nEnter your question: `)
console.log('\n')
rl.close()

main(type, web_url, question)
