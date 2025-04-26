import { QdrantClient } from '@qdrant/js-client-rest'
import neo4j from 'neo4j-driver'
// import { GoogleGenerativeAI } from '@google/generative-ai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import 'cheerio'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import ora from 'ora'
import chalk from 'chalk'
import dotenv from 'dotenv'
dotenv.config()

//?? VARIABLES
let client
let driver
const collectionName = 'neo4_quad_kg'
const embeddingSize = 768
const myDocuments = [
   { content: 'The capital of France is Paris.', source: 'knowledge_base_1' },
   {
      content: 'JavaScript is a versatile programming language.',
      source: 'web_doc_1',
   },
]

//?? INITIALIZATION

//~ Neo4j connection locally
const URI = process.env.NEO4J_URI
const USER = process.env.NEO4J_USERNAME
const PASSWORD = process.env.NEO4J_PASSWORD
driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
await driver
   .getServerInfo()
   .then((info) => {
      console.log('\nConnection established to Neo4j\n')
      console.log(info)
   })
   .catch((err) => {
      console.log(`Neo4j Connection error\n${err}\nCause: ${err.cause}`)
   })
//~ Closing Neo4j connection
// if (driver) {
//    console.log('\nClosing Neo4j connection...')
//    await driver.close()
// }

//~ Qdrant connection locally
client = new QdrantClient({ url: process.env.QDRANT_URL })
const result = await client.getCollections()
console.log('List of Qdrant collections:', result.collections)

//~ Google Generative AI connection
// const llm = new ChatGoogleGenerativeAI({
//    model: 'gemini-2.0-flash',
//    temperature: 0,
// })
const embeddings = new GoogleGenerativeAIEmbeddings({
   model: 'text-embedding-004', // Or your chosen model
})

//?? INITIALIZING DONE

//?? RAG WORKING
async function main(type, web_url, question) {
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
      }
      console.log('docs :', docs)
      const splitter = new RecursiveCharacterTextSplitter({
         chunkSize: 1000,
         chunkOverlap: 200,
      })

      const allSplits = await splitter.splitDocuments(docs)
      console.log('allSplits :', allSplits)
      spinnerIndex.succeed('Document Preparation Done')
   } catch (err) {
      console.error('Error during document loading:', err)
      spinnerIndex.fail('Document Preparation Failed')
      return
   }

   //~ Ingestion of documents into Neo4j
}

//?? MAIN FUNCTION CALL
const rl = readline.createInterface({ input, output })
const type = await rl.question(
   chalk.bold.blue`\nEnter the type of Data source (web or pdf): `
)
const web_url = await rl.question(
   chalk.bold.blue`\nEnter the URL of the website: `
)
const question = await rl.question(chalk.bold.blue`\nEnter your question: `)
console.log('\n')
rl.close()

main(type, web_url, question)
