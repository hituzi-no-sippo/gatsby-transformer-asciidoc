const asciidoc = require(`asciidoctor`)()
const _ = require(`lodash`)
const matter = require(`gray-matter`)
const yaml = require(`js-yaml`)

const {
  emptyAttributeNamesInPageAttributes, EMPTY_ATTRIBUTE_VALUE
} = require(`./empty-value-with-attribute`)

async function onCreateNode(
  {
    node,
    actions,
    pathPrefix,
    loadNodeContent,
    createNodeId,
    reporter,
    createContentDigest,
  },
  pluginOptions
) {
  const extensionsConfig = pluginOptions.fileExtensions

  // make extensions configurable and use adoc and asciidoc as default
  const supportedExtensions =
    typeof extensionsConfig !== `undefined` && extensionsConfig instanceof Array
      ? extensionsConfig
      : [`adoc`, `asciidoc`]

  if (!supportedExtensions.includes(node.extension)) {
    return
  }

  // register custom converter if given
  if (pluginOptions.converterFactory) {
    asciidoc.ConverterFactory.register(
      new pluginOptions.converterFactory(asciidoc),
      [`html5`]
    )
  }

  // changes the incoming imagesdir option to take the
  const asciidocOptions = processPluginOptions(pluginOptions, pathPrefix)

  const { createNode, createParentChildLink } = actions
  // Load Asciidoc contents
  const content = await loadNodeContent(node)
  // Load Asciidoc file for extracting
  // https://asciidoctor-docs.netlify.com/asciidoctor.js/processor/extract-api/
  // We use a `let` here as a warning: some operations, like .convert() mutate the document
  let doc = await asciidoc.load(content, asciidocOptions)

  try {
    const html = doc.convert()
    // Use "partition" option to be able to get title, subtitle, combined
    const title = doc.getDocumentTitle({ partition: true })
    const description =  doc.getAttribute(`description`)

    let revision = null
    let author = null

    if (doc.hasRevisionInfo()) {
      revision = {
        date: doc.getRevisionDate(),
        number: doc.getRevisionNumber(),
        remark: doc.getRevisionRemark(),
      }
    }

    if (doc.getAuthor()) {
      author = {
        fullName: doc.getAttribute(`author`),
        firstName: doc.getAttribute(`firstname`),
        lastName: doc.getAttribute(`lastname`),
        middleName: doc.getAttribute(`middlename`),
        authorInitials: doc.getAttribute(`authorinitials`),
        email: doc.getAttribute(`email`),
      }
    }

    let pageAttributes = extractPageAttributes(
      doc.getAttributes(), pluginOptions.definesEmptyAttributes
    )

    const frontmatterData = matter(content)

    const asciiNode = {
      id: createNodeId(`${node.id} >>> ASCIIDOC`),
      parent: node.id,
      internal: {
        type: `Asciidoc`,
        mediaType: `text/html`,
        content: frontmatterData.content
      },
      children: [],
      html,
      document: {
        title: title.getCombined(),
        subtitle: title.getSubtitle(),
        main: title.getMain(),
        description,
      },
      revision,
      author,
      pageAttributes,
      frontmatter: frontmatterData.data
    }

    asciiNode.internal.contentDigest = createContentDigest(asciiNode)

    createNode(asciiNode)
    createParentChildLink({ parent: node, child: asciiNode })
  } catch (err) {
    reporter.panicOnBuild(
      `Error processing Asciidoc ${
        node.absolutePath ? `file ${node.absolutePath}` : `in node ${node.id}`
      }:\n
      ${err.message}`
    )
  }
}

const processPluginOptions = _.memoize((pluginOptions, pathPrefix) => {
  const processAsciidoctorAttributes = attributes => {
    const defaultImagesDir = `/images@`
    const currentPathPrefix = pathPrefix || ``
    const defaultSkipFrontMatter = true

    if (attributes === undefined) {
      attributes = {}
    }

    attributes.imagesdir = withPathPrefix(
      currentPathPrefix,
      attributes.imagesdir || defaultImagesDir
    )

    if (attributes[`skip-front-matter`] === undefined) {
      attributes[`skip-front-matter`] = defaultSkipFrontMatter
    }

    return attributes
  }

  const clonedPluginOptions = _.cloneDeep(pluginOptions)

  clonedPluginOptions.attributes =
    processAsciidoctorAttributes(clonedPluginOptions.attributes)

  return clonedPluginOptions
})

const withPathPrefix = (pathPrefix, url) =>
  (pathPrefix + url).replace(/\/\//, `/`)

const extractPageAttributes = (allAttributes, definesEmptyAttributes = true) =>
  Object.entries(allAttributes).reduce((pageAttributes, [key, value]) => {
    if (key.startsWith(`page-`)) {
      const fieldName = key.replace(/^page-/, ``)
      let fieldvalue

      if (value === EMPTY_ATTRIBUTE_VALUE && definesEmptyAttributes) {
        fieldvalue = EMPTY_ATTRIBUTE_VALUE
        emptyAttributeNamesInPageAttributes.add(fieldName)
      } else {
        fieldvalue = yaml.safeLoad(value)
      }
      pageAttributes[fieldName] = fieldvalue
    }

    return pageAttributes
  }, {})

module.exports = onCreateNode