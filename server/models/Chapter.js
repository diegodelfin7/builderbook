import mongoose, { Schema } from 'mongoose';
import marked from 'marked';
import he from 'he';
import hljs from 'highlight.js';

import generateSlug from '../utils/slugify';
import Book from './Book';
import Purchase from './Purchase';

function markdownToHtml(content) {
  const renderer = new marked.Renderer();

  renderer.link = (href, title, text) => {
    const t = title ? ` title="${title}"` : '';
    return `<a target="_blank" href="${href}" rel="noopener noreferrer"${t}>${text}</a>`;
  };

  renderer.image = href => `<img src="${href}" width="100%" alt="Builder Book">`;

  renderer.heading = (text, level) => {
    const escapedText = text
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, '-');

    if (level === 2) {
      return `<a
        class="section-anchor"
        name="${escapedText}"
        href="#${escapedText}"
        >
        <h${level} class="chapter-section" style="color: #222; font-weight: 400;">
          ${text}
        </h${level}>
      </a>`;
    }

    if (level === 4) {
      return `<a
        name="${escapedText}"
        href="#${escapedText}"
        >
        <h${level} style="color: #222;">
          ${text}
        </h${level}>
      </a>`;
    }

    return `<h${level} style="color: #222; font-weight: 400;">${text}</h${level}>`;
  };

  marked.setOptions({
    renderer,
    breaks: true,
    highlight(code, lang) {
      if (!lang) {
        return hljs.highlightAuto(code).value;
      }

      return hljs.highlight(lang, code).value;
    },
  });

  return marked(he.decode(content));
}

function getSections(content) {
  const renderer = new marked.Renderer();

  const sections = [];
  renderer.heading = (text, level) => {
    if (level !== 2) {
      return;
    }

    const escapedText = text
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, '-');

    sections.push({ text, level, escapedText });
  };

  marked.setOptions({
    renderer,
  });

  marked(he.decode(content));

  return sections;
}

const mongoSchema = new Schema({
  bookId: {
    type: Schema.Types.ObjectId,
    required: true,
  },
  isFree: {
    type: Boolean,
    required: true,
    default: false,
  },
  githubFilePath: {
    type: String,
  },
  title: {
    type: String,
    required: true,
  },
  slug: {
    type: String,
    required: true,
  },
  excerpt: {
    type: String,
    default: '',
  },
  content: {
    type: String,
    default: '',
    required: true,
  },
  htmlContent: {
    type: String,
    default: '',
    required: true,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  order: {
    type: Number,
    required: true,
  },
  seoTitle: String,
  seoDescription: String,
  sections: [
    {
      text: String,
      level: Number,
      escapedText: String,
    },
  ],
});

class ChapterClass {
  static async addBookmark({
    chapterId, hash, text, userId,
  }) {
    if (!userId) {
      throw new Error('User is required');
    }

    const chapter = await this.findById(chapterId, 'bookId');
    if (!chapter) {
      throw new Error('Chapter not found');
    }

    const book = await Book.findById(chapter.bookId, 'id');
    if (!book) {
      throw new Error('Book not found');
    }

    const purchase = await Purchase.findOne({ userId, bookId: book._id }, 'id bookmarks');
    if (!purchase) {
      throw new Error('You have not bought this book.');
    }

    purchase.bookmarks.forEach((b) => {
      if (b.chapterId.equals(chapterId)) {
        purchase.bookmarks.pull(b._id);
      }
    });
    purchase.bookmarks.push({ chapterId, hash, text });

    return purchase.save();
  }

  static async getBySlug({
    bookSlug, chapterSlug, userId, isAdmin,
  }) {
    const book = await Book.getBySlug({ slug: bookSlug, userId });
    if (!book) {
      throw new Error('Not found');
    }

    const chapter = await this.findOne({ bookId: book._id, slug: chapterSlug });

    if (!chapter) {
      throw new Error('Not found');
    }

    const chapterObj = chapter.toObject();
    chapterObj.book = book;

    if (userId) {
      const purchase = await Purchase.findOne({ userId, bookId: book._id }, 'bookmarks');

      chapterObj.isPurchased = !!purchase || isAdmin;

      ((purchase && purchase.bookmarks) || []).forEach((b) => {
        if (chapter._id.equals(b.chapterId)) {
          chapterObj.bookmark = b;
        }
      });
    }

    const isPurchased = chapter.isFree || chapterObj.isPurchased;

    if (!isPurchased) {
      delete chapterObj.content;
    }

    return chapterObj;
  }

  static async syncContent({ book, data }) {
    const {
      title,
      excerpt = '',
      isFree = false,
      seoTitle = '',
      seoDescription = '',
    } = data.attributes;

    const { body, path } = data;

    const chapter = await this.findOne({
      bookId: book.id,
      githubFilePath: path,
    });

    let order;

    if (path === 'introduction.md') {
      order = 1;
    } else {
      order = parseInt(path.match(/[0-9]+/), 10) + 1;
    }

    const content = body;
    const htmlContent = markdownToHtml(content);
    const sections = getSections(content);

    if (!chapter) {
      const slug = await generateSlug(this, title, { bookId: book._id });

      return this.create({
        bookId: book._id,
        githubFilePath: path,
        title,
        slug,
        isFree,
        content,
        htmlContent,
        sections,
        excerpt: marked(he.decode(excerpt)),
        order,
        seoTitle,
        seoDescription,
        createdAt: new Date(),
      });
    }

    const modifier = {
      content,
      htmlContent,
      sections,
      excerpt: marked(he.decode(excerpt)),
      isFree,
      order,
      seoTitle,
      seoDescription,
    };

    if (title !== chapter.title) {
      modifier.title = title;
      modifier.slug = await generateSlug(this, title, {
        bookId: chapter.bookId,
      });
    }

    return this.updateOne({ _id: chapter._id }, { $set: modifier });
  }
}

mongoSchema.index({ bookId: 1, slug: 1 }, { unique: true });
mongoSchema.index({ bookId: 1, githubFilePath: 1 }, { unique: true });

mongoSchema.loadClass(ChapterClass);

const Chapter = mongoose.model('Chapter', mongoSchema);

export default Chapter;
