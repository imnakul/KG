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

//?? INITILIZATION
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

//~ Neo4j Connection
const URI = process.env.NEO4J_URI
const USER = process.env.NEO4J_USERNAME
const PASSWORD = process.env.NEO4J_PASSWORD
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
await driver
   .getServerInfo()
   .then((info) => {
      console.log('\nConnection established to Neo4j\n')
      // console.log(info)
   })
   .catch((err) => {
      console.log(`Neo4j Connection error\n${err}\nCause: ${err.cause}`)
   })

//?? INITILIZATION END

//?? FUNCTIONS DECLARATIONS
//? Not using right Now , becuase was generating more Nodes and Relationships
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

//? To control Calls to Gemini API
function sleep(ms) {
   return new Promise((resolve) => setTimeout(resolve, ms))
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
//?? FUNCTIONS DECLARATIONS END

//?? MAIN FUNCTION
async function main(type, web_url, question) {
   //~ Document Fetching, creating Chunks using LANGCHAIN
   let allSplits
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

   //~ Creating Entities / Relationships from Retrieved Docs Chunks!
   const graphDataset = new Set()
   const enrichedChunks = await processAllSplits(allSplits)
   console.log(JSON.stringify(enrichedChunks, null, 2))

   for (const chunk of enrichedChunks) {
      try {
         const graphData = await geminiSingleRelationshipParser(
            chunk.titleAndSummary
         )
         console.log('Graph Data:', JSON.stringify(graphData, null, 2))
         if (graphData) {
            graphDataset.add(JSON.stringify(graphData))
         }
         await sleep(1000) // Sleep for 1 seconds to control API calls
      } catch (error) {
         console.error('Error while parsing graph data:', error.message)
      }
   }

   console.log('Unique Graph Data:', graphDataset)

   //~ Ingesting graphDataset into Neo4j

   const session = driver.session()

   // Create maps to store nodes and relationships
   const nodes = new Map()
   const relationships = []
   const spinnerIngest = ora('Ingesting data to Neo4j...\n').start()
   try {
      // Process your Set and prepare nodes and relationships
      for (const item of graphDataset) {
         const { node, target_node, relationship } = JSON.parse(item)

         // Add nodes if they don't exist
         if (!nodes.has(node)) {
            nodes.set(
               node,
               `${node}_${Math.random().toString(36).substring(2, 8)}`
            ) // simple unique id
         }
         if (!nodes.has(target_node)) {
            nodes.set(
               target_node,
               `${target_node}_${Math.random().toString(36).substring(2, 8)}`
            )
         }

         // Add relationship
         relationships.push({
            source: nodes.get(node),
            target: nodes.get(target_node),
            type: relationship,
         })
      }

      // Ingest nodes
      for (const [name, id] of nodes.entries()) {
         await session.run('CREATE (n:Entity {id: $id, name: $name})', {
            id,
            name,
         })
      }

      // Ingest relationships
      for (const rel of relationships) {
         await session.run(
            `
          MATCH (a:Entity {id: $source_id}), (b:Entity {id: $target_id})
          CREATE (a)-[:RELATIONSHIP {type: $type}]->(b)
        `,
            {
               source_id: rel.source,
               target_id: rel.target,
               type: rel.type,
            }
         )
      }
      console.log('\n')
      spinnerIngest.succeed(
         chalk.bold.bgGreen.black('Data ingested successfully!')
      )
   } catch (error) {
      console.log('\n')
      spinnerIngest.fail(chalk.bold.bgRed('Data ingestion failed'))
      console.error('\nError ingesting data to Neo4j:', error)
   } finally {
      await session.close()
      await driver.close()
      console.log('\nNeo4j connection closed.\n')
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
