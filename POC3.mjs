import neo4j from 'neo4j-driver'
import 'cheerio'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import ora from 'ora'
import chalk from 'chalk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
dotenv.config()

//?? Document Preparation using Langchain

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

async function geminiLLMParser(prompt) {
   const result = await model.generateContent({
      contents: [
         {
            role: 'user',
            parts: [
               {
                  text: `
  You are a precise graph relationship extractor.
  Extract all relationships from the text and format them as a JSON object with this exact structure:
  
  {
    "graph": [
      {
        "node": "Person/Entity",
        "target_node": "Related Entity",
        "relationship": "Type of Relationship"
      }
      ... more relationships ...
    ]
  }
  
  Include ALL relationships mentioned in the text, including implicit ones. Be thorough and precise.
  
  Now, here's the text:
  ${prompt}
  `,
               },
            ],
         },
      ],
   })

   const response = await result.response
   let rawText = response.text().trim()

   // Fix: If Gemini returns ```json code block, remove it
   if (rawText.startsWith('```json')) {
      rawText = rawText.replace(/```json|```/g, '').trim()
   }

   // Parse using our GraphComponents class
   try {
      return GraphComponents.fromJSON(rawText)
   } catch (error) {
      console.error('Failed to parse Graph JSON:', rawText)
      return null
   }
}

async function geminiSingleRelationshipParser(prompt) {
   const result = await model.generateContent({
      contents: [
         {
            role: 'user',
            parts: [
               {
                  text: `
    You are a precise graph relationship extractor.
    Extract a single relationship from the text and format it as a JSON object with this exact structure:
    
    {
      "node": "Person/Entity",
      "target_node": "Related Entity",
      "relationship": "Type of Relationship"
    }
    
    Identify the MOST salient relationship mentioned in the text. Be precise.
    
    Now, here's the text:
    ${prompt}
    `,
               },
            ],
         },
      ],
   })

   const response = await result.response
   let rawText = response.text().trim()

   // Fix: If Gemini returns ```json code block, remove it
   if (rawText.startsWith('```json')) {
      rawText = rawText.replace(/```json|```/g, '').trim()
   }

   // Parse using our GraphComponents class (assuming it can handle a single object)
   try {
      const parsed = JSON.parse(rawText)
      // Ensure the parsed object has the expected keys
      if (
         parsed &&
         typeof parsed.node === 'string' &&
         typeof parsed.target_node === 'string' &&
         typeof parsed.relationship === 'string'
      ) {
         return parsed
      } else {
         console.error(
            'Parsed JSON does not match expected single relationship format:',
            parsed
         )
         return null
      }
   } catch (error) {
      console.error('Failed to parse single Graph JSON:', rawText, error)
      return null
   }
}

const ENTITY_EXTRACTION_PROMPT = (text) => `
Extract key entities and classify them into categories like Person, Organization, Event, Concept, Place.

Return ONLY a JSON array format like this:
[
  {"name": "EntityName", "type": "EntityType"}
]

Text:
"${text}"
`
const CYPHER_GENERATION_TEMPLATE = (schema, question) => `
Task:Generate Cypher statement to generate a graph database.
Instructions:
Use only the provided relationship types and properties in the schema.
Do not use any other relationship types or properties that are not provided.

Schema:
${schema}

Note: Do not include any explanations or apologies in your responses.
Only respond with the generated Cypher statement.

The data is:
${question}
`
// async function extractEntities(text) {
//    const result = await model.generateContent(ENTITY_EXTRACTION_PROMPT(text))
//    const response = await result.response
//    let rawText = response.text().trim()

//    // 🚑 Fix: If Gemini returns code block (```json ... ```), remove it
//    if (rawText.startsWith('```json')) {
//       rawText = rawText.replace(/```json|```/g, '').trim()
//    }

//    try {
//       return JSON.parse(rawText)
//    } catch (error) {
//       console.error('Failed to parse JSON:', rawText)
//       return []
//    }
// }

// async function generateCypher(schema, question) {
//    const result = await model.generateContent(
//       CYPHER_GENERATION_TEMPLATE(schema, question)
//    )
//    const response = await result.response
//    return response.text().trim()
// }

class Single {
   constructor(node, target_node, relationship) {
      this.node = node
      this.target_node = target_node
      this.relationship = relationship
   }
}

class GraphComponents {
   constructor(graph = []) {
      this.graph = graph
   }

   static fromJSON(jsonData) {
      const parsed = JSON.parse(jsonData)
      const graph = parsed.graph.map(
         (item) => new Single(item.node, item.target_node, item.relationship)
      )
      return new GraphComponents(graph)
   }
}

async function generateTitleAndSummary(text) {
   const prompt = `
  For the following text:
  1. Generate a short and clear Title (max 10 words).
  2. Summarize the main idea in one sentence (max 30 words).
  
  Text:
  ${text}
  
  Format the output strictly like this:
  
  Title: [your generated title]
  Summary: [your generated summary]
    `

   const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
   })

   const response = result.response
   const outputText = response.text()

   return outputText
}

async function processAllSplits(allSplits) {
   const results = []

   for (const doc of allSplits) {
      const pageContent = doc.pageContent
      const output = await generateTitleAndSummary(pageContent)

      results.push({
         originalContent: pageContent,
         metadata: doc.metadata,
         titleAndSummary: output,
      })
   }

   return results
}

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
   //~ We Have chunks of data ready to be converted!
   //    //    const yourChunk = `Elon Musk founded SpaceX with the goal of making Mars colonization possible. Tesla, another company he leads, focuses on electric vehicles.`

   //    console.log('🔵 Extracting entities...')
   //    const entities = await extractEntities(allSplits[0].pageContent)
   //    console.log('Entities Found:', entities)

   //    const schema = `
   // (:Person)-[:FOUNDED]->(:Organization)
   // (:Organization)-[:WORKS_ON]->(:Project)
   // `

   //    //    const yourQuestion = 'Which organizations did Elon Musk found?'

   //    console.log('\n🟣 Generating Cypher query...')
   //    const cypherQuery = await generateCypher(schema, question)
   //    console.log('Cypher Query:\n', cypherQuery)

   //    const inputText = 'Steve Jobs founded Apple. Apple acquired Beats.'
   const graphDataset = new Set()

   const enrichedChunks = await processAllSplits(allSplits)
   console.log(JSON.stringify(enrichedChunks, null, 2))

   for (const chunk of enrichedChunks) {
      const graphData = await geminiSingleRelationshipParser(
         chunk.titleAndSummary
      )
      console.log('Graph Data:', JSON.stringify(graphData, null, 2))
      //   for (const item of graphData.graph) {
      //      graphDataset.add(JSON.stringify(item))
      //   }
      if (graphData) {
         graphDataset.add(JSON.stringify(graphData))
      }
   }
   console.log('Unique Graph Data:', graphDataset)
   //    const graphData = await geminiLLMParser(allSplits[0].pageContent)

   //    console.log(JSON.stringify(graphData, null, 2))
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
