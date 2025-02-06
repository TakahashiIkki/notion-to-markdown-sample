const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
require("dotenv").config();

// .env から環境変数を取得
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;

const notion = new Client({ auth: NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

/**
 * 指定したブロック（またはページ）の子ブロックをページネーション対応で取得する
 */
const getBlockChildren = async (blockId) => {
  let results = [];
  let cursor;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
    });
    results = results.concat(response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return results;
};

/**
 * Notion の URL からページID を抽出する  
 * （ハイフンの有無に関わらず、最終的にハイフン無しの文字列を返す）
 */
const extractPageId = (url) => {
  const regex = /([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
  const match = url.match(regex);
  return match ? match[0].replace(/-/g, "") : null;
};

/**
 * メインページのブロック群からリンク先の Notion ページID を抽出する  
 * 対象:
 *  - child_page ブロックの場合（直接リンクされているページ）
 *  - リッチテキスト内の href に notion.so が含まれる場合
 */
const extractLinkedPageIds = (blocks) => {
  const pageIds = new Set();
  const textBlockTypes = [
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "quote",
    "bulleted_list_item",
    "numbered_list_item",
    "callout",
  ];

  blocks.forEach((block) => {
    if (block.type === "child_page") {
      pageIds.add(block.id.replace(/-/g, ""));
    } else if (textBlockTypes.includes(block.type)) {
      const richTexts = block[block.type].rich_text;
      richTexts.forEach((item) => {
        if (item.href && item.href.includes("notion.so")) {
          const pid = extractPageId(item.href);
          if (pid) pageIds.add(pid);
        }
      });
    }
  });
  return Array.from(pageIds);
};

const main = async () => {
  console.log(`Main page ID: ${NOTION_PAGE_ID}`);

  const mainBlocks = await getBlockChildren(NOTION_PAGE_ID);
  if (!mainBlocks || mainBlocks.length === 0) {
    console.error("メインページのブロックが取得できませんでした。");
    return;
  }

  const linkedPageIds = extractLinkedPageIds(mainBlocks);
  console.log("抽出したリンク先ページID:", linkedPageIds);

  for (const pageId of linkedPageIds) {
    console.log(`Processing linked page: ${pageId}`);
    try {
      // notion-to-md を使って指定したページを Markdown ブロックに変換
      const mdBlocks = await n2m.pageToMarkdown(pageId);
      // Markdown ブロック群から文字列へ変換
      let mdString = n2m.toMarkdownString(mdBlocks);
      if (typeof mdString === "object") {
        mdString = mdString.parent || JSON.stringify(mdString, null, 2);
      }
      // ファイルに保存（例: {pageId}.md）
      fs.writeFileSync(`./dist/${pageId}.md`, mdString);
      console.log(`Saved markdown for page ${pageId} to ${pageId}.md`);
    } catch (error) {
      console.error(`ページ ${pageId} の処理中にエラーが発生しました:`, error);
    }
  }
};

main();
