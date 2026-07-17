import express from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { mkdir, rm } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import env from "dotenv";
import multer from "multer";
import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import bcrypt from "bcrypt";
import connectPgSimple from "connect-pg-simple";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import sharp from "sharp";

const envFile =
  process.env.NODE_ENV === "development" ? ".env.development" : ".env";
env.config({ path: envFile });

const app = express();
const port = process.env.SERVER_PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV !== "development";
const uploadDirectory = "/tmp/homestead-puppies-uploads";

await mkdir(uploadDirectory, { recursive: true });

const s3 = new S3Client();

const upload = multer({
  dest: uploadDirectory,
  limits: {
    fileSize: 52428800,
    files: 50,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image uploads are allowed."));
  },
});

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required.");
}

if (!process.env.BUCKET) {
  throw new Error("BUCKET is required.");
}

const dbConfig = {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
};

const PostgreSqlStore = connectPgSimple(session);
const sessionStore = new PostgreSqlStore({
  conObject: dbConfig,
  createTableIfMissing: true,
  tableName: "user_sessions",
  ttl: 8 * 60 * 60,
});

sessionStore.on("error", (error) => {
  console.error("Session store error:", error);
});

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'", "https://api.web3forms.com"],
        frameAncestors: ["'self'"],
        frameSrc: ["'self'", "https://*.paypal.com", "https://*.hcaptcha.com"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://d3trlmj493rccc.cloudfront.net",
          "https://*.paypal.com",
          "https://*.paypalobjects.com",
          "https://*.hcaptcha.com",
        ],
        connectSrc: [
          "'self'",
          "https://api.web3forms.com",
          "https://*.paypal.com",
          "https://*.paypalobjects.com",
          "https://*.hcaptcha.com",
          "https://cloudflareinsights.com",
        ],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://www.paypal.com",
          "https://www.paypalobjects.com",
          "https://web3forms.com",
          "https://js.hcaptcha.com",
          "https://static.cloudflareinsights.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginResourcePolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=()",
  );
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "1mb" }));
app.use(
  express.static(`${__dirname}/public`, {
    maxAge: "7d",
  }),
);

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    name: "homestead.sid",
    proxy: isProduction,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: isProduction,
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) =>
    ipKeyGenerator(req.get("CF-Connecting-IP") || req.ip || "127.0.0.1"),
  message: "Too many login attempts. Please try again in 15 minutes.",
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect("/login");
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("Origin");
  const fetchSite = req.get("Sec-Fetch-Site");
  const allowedOrigins = new Set([
    "https://homestead-puppies.com",
    "https://www.homestead-puppies.com",
  ]);

  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).send("Cross-site request blocked.");
  }

  if (fetchSite === "cross-site") {
    return res.status(403).send("Cross-site request blocked.");
  }

  return next();
}

function requireCsrf(req, res, next) {
  const suppliedToken = req.body?._csrf || req.get("X-CSRF-Token");
  const expectedToken = req.session.csrfToken;
  const suppliedBuffer = Buffer.from(suppliedToken || "");
  const expectedBuffer = Buffer.from(expectedToken || "");

  if (
    suppliedBuffer.length === expectedBuffer.length &&
    suppliedBuffer.length > 0 &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return next();
  }

  return res.status(403).send("Invalid or expired security token.");
}

async function cleanupLocalFiles(files = []) {
  await Promise.all(
    files.map((file) => rm(file.path, { force: true }).catch(() => undefined)),
  );
}

async function deleteS3Keys(keys = []) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return;

  const result = await s3.send(
    new DeleteObjectsCommand({
      Bucket: process.env.BUCKET,
      Delete: {
        Objects: uniqueKeys.map((key) => ({ Key: key })),
        Quiet: true,
      },
    }),
  );

  if (result.Errors?.length) {
    throw new Error(
      `Unable to delete ${result.Errors.length} object(s) from storage.`,
    );
  }
}

async function optimizeAndUploadImages(files = []) {
  const uploaded = [];
  const allowedFormats = new Set([
    "avif",
    "gif",
    "heif",
    "jpeg",
    "png",
    "tiff",
    "webp",
  ]);

  try {
    for (const file of files) {
      const image = sharp(file.path, {
        failOn: "error",
        limitInputPixels: 40_000_000,
      });
      const metadata = await image.metadata();

      if (!metadata.format || !allowedFormats.has(metadata.format)) {
        throw new Error(`Unsupported image format: ${file.originalname}`);
      }

      const body = await image
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      const key = `images/${Date.now()}-${randomUUID()}.webp`;

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.BUCKET,
          Key: key,
          Body: body,
          CacheControl: "public, max-age=31536000, immutable",
          ContentDisposition: "inline",
          ContentType: "image/webp",
        }),
      );

      uploaded.push({ key });
      await rm(file.path, { force: true });
    }

    return uploaded;
  } catch (error) {
    await cleanupLocalFiles(files);
    await deleteS3Keys(uploaded.map((file) => file.key)).catch(() => undefined);
    throw error;
  }
}

const db = new pg.Client(dbConfig);

await db.connect();

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/availablePuppies", async (req, res) => {
  const availableResult = await db.query(
    "SELECT * FROM puppies WHERE id > 0 ORDER BY id ASC",
  );
  const puppies = availableResult.rows;
  const imageURLsResult = await db.query("SELECT * FROM puppyimages");
  const imageURLs = imageURLsResult.rows;
  const breedResults = await db.query(
    "SELECT * FROM breeds ORDER BY breed ASC",
  );
  const breeds = breedResults.rows;
  res.render("availablePuppies.ejs", {
    puppies: puppies,
    imageURLs: imageURLs,
    breeds: breeds,
  });
});

app.get("/parents", async (req, res) => {
  const availableResult = await db.query(
    "SELECT * FROM parents WHERE parentid > 0 ORDER BY parentid ASC",
  );
  const parents = availableResult.rows;
  const imageURLsResult = await db.query("SELECT * FROM parentimages");
  const imageURLs = imageURLsResult.rows;
  const breedResults = await db.query(
    "SELECT * FROM breeds ORDER BY breed ASC",
  );
  const breeds = breedResults.rows;
  res.render("parents.ejs", {
    parents: parents,
    imageURLs: imageURLs,
    breeds: breeds,
  });
});

app.post("/filterPuppies", async (req, res) => {
  let breedFilter = req.body.breedFilter;
  let genderFilter = req.body.genderFilter;
  breedFilter == "All Breeds" ? (breedFilter = "%") : null;
  genderFilter == "All Genders" ? (genderFilter = "%") : null;
  const availableResult = await db.query(
    "SELECT * FROM puppies WHERE id > 0 AND breed LIKE $1 AND gender LIKE $2 ORDER BY id ASC",
    [breedFilter, genderFilter],
  );
  const puppies = availableResult.rows;
  const imageURLsResult = await db.query("SELECT * FROM puppyimages");
  const imageURLs = imageURLsResult.rows;
  const breedResults = await db.query(
    "SELECT * FROM breeds ORDER BY breed ASC",
  );
  const breeds = breedResults.rows;
  res.render("availablePuppies.ejs", {
    puppies: puppies,
    imageURLs: imageURLs,
    breeds: breeds,
    breedFilter: breedFilter,
    genderFilter: genderFilter,
  });
});

app.post("/filterParents", async (req, res) => {
  let breedFilter = req.body.breedFilter;
  breedFilter == "All Breeds" ? (breedFilter = "%") : null;
  const availableResult = await db.query(
    "SELECT * FROM parents WHERE parentid > 0 AND breed LIKE $1 ORDER BY parentid ASC",
    [breedFilter],
  );
  const parents = availableResult.rows;
  const imageURLsResult = await db.query("SELECT * FROM parentimages");
  const imageURLs = imageURLsResult.rows;
  const breedResults = await db.query(
    "SELECT * FROM breeds ORDER BY breed ASC",
  );
  const breeds = breedResults.rows;
  res.render("parents.ejs", {
    parents: parents,
    imageURLs: imageURLs,
    breeds: breeds,
    breedFilter: breedFilter,
  });
});

app.get("/deposit", (req, res) => {
  res.render("deposit.ejs", { includePayPal: true });
});

app.get("/contact", (req, res) => {
  res.render("contact.ejs");
});

app.get("/success", (req, res) => {
  res.render("success.ejs");
});

app.get("/login", (req, res) => {
  const message = req.session.messages?.[0] || null;
  req.session.messages = []; // clear it so it doesn't persist
  res.render("login.ejs", { message });
});

app.post("/logout", requireAuth, requireCsrf, (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      res.clearCookie("homestead.sid");
      return res.redirect("/");
    });
  });
});

app.post(
  "/login",
  loginLimiter,
  requireCsrf,
  passport.authenticate("local", {
    successRedirect: "/adminHome",
    failureRedirect: "/login",
    failureMessage: true,
  }),
);

app.get("/adminHome", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("./admin/adminHome.ejs");
  } else {
    res.redirect("/login");
  }
});

app.get("/addPuppy", async (req, res) => {
  if (req.isAuthenticated()) {
    const breedResults = await db.query(
      "SELECT * FROM breeds ORDER BY breed ASC",
    );
    const breeds = breedResults.rows;
    const motherResults = await db.query(
      "SELECT name FROM parents WHERE gender = 'Female' ORDER BY name ASC",
    );
    const mothers = motherResults.rows;
    const fatherResults = await db.query(
      "SELECT name FROM parents WHERE gender = 'Male' ORDER BY name ASC",
    );
    const fathers = fatherResults.rows;
    res.render("./admin/addPuppy.ejs", {
      breeds: breeds,
      mothers: mothers,
      fathers: fathers,
    });
  } else {
    res.redirect("/login");
  }
});

app.get("/addParent", async (req, res) => {
  if (req.isAuthenticated()) {
    const breedResults = await db.query(
      "SELECT * FROM breeds ORDER BY breed ASC",
    );
    const breeds = breedResults.rows;
    res.render("./admin/addParent.ejs", { breeds: breeds });
  } else {
    res.redirect("/login");
  }
});

app.get("/manageBreeds", async (req, res) => {
  if (req.isAuthenticated()) {
    const results = await db.query("SELECT * FROM breeds ORDER BY breed ASC");
    const breeds = results.rows;
    res.render("./admin/manageBreeds.ejs", { breeds: breeds });
  } else {
    res.redirect("/login");
  }
});

app.get("/manageParents", async (req, res) => {
  if (req.isAuthenticated()) {
    const parentResults = await db.query(
      "SELECT * FROM parents WHERE parentid > 0 ORDER BY parentid ASC",
    );
    const parents = parentResults.rows;
    const imageURLsResult = await db.query("SELECT * FROM parentimages");
    const imageURLs = imageURLsResult.rows;
    const breedResults = await db.query(
      "SELECT * FROM breeds ORDER BY breed ASC",
    );
    const breeds = breedResults.rows;
    res.render("./admin/manageParents.ejs", {
      parents: parents,
      imageURLs: imageURLs,
      breeds: breeds,
    });
  } else {
    res.redirect("/login");
  }
});

app.get("/managePuppies", async (req, res) => {
  if (req.isAuthenticated()) {
    const availableResult = await db.query(
      "SELECT * FROM puppies WHERE id > 0 ORDER BY id ASC",
    );
    const puppies = availableResult.rows;
    const imageURLsResult = await db.query("SELECT * FROM puppyimages");
    const imageURLs = imageURLsResult.rows;
    const breedResults = await db.query(
      "SELECT * FROM breeds ORDER BY breed ASC",
    );
    const breeds = breedResults.rows;
    const motherResults = await db.query(
      "SELECT name FROM parents WHERE gender = 'Female' ORDER BY name ASC",
    );
    const mothers = motherResults.rows;
    const fatherResults = await db.query(
      "SELECT name FROM parents WHERE gender = 'Male' ORDER BY name ASC",
    );
    const fathers = fatherResults.rows;
    res.render("./admin/managePuppies.ejs", {
      puppies: puppies,
      imageURLs: imageURLs,
      breeds: breeds,
      mothers: mothers,
      fathers: fathers,
    });
  } else {
    res.redirect("/login");
  }
});

app.post("/deletePuppyImage", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    const result = await db.query(
      "DELETE FROM puppyimages WHERE imageid = $1 RETURNING imageid",
      [req.body.photoDeleteID],
    );
    await deleteS3Keys(result.rows.map((row) => row.imageid));
    res.redirect("/managePuppies");
  } else {
    res.redirect("/login");
  }
});

app.post("/deleteParentImage", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    const result = await db.query(
      "DELETE FROM parentimages WHERE imageid = $1 RETURNING imageid",
      [req.body.photoDeleteID],
    );
    await deleteS3Keys(result.rows.map((row) => row.imageid));
    res.redirect("/manageParents");
  } else {
    res.redirect("/login");
  }
});

app.post("/deletePuppy", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    const imageResult = await db.query(
      "SELECT imageid FROM puppyimages WHERE puppyid = $1",
      [req.body.id],
    );
    try {
      await db.query("BEGIN");
      await db.query("DELETE FROM puppyimages WHERE puppyid=$1", [req.body.id]);
      await db.query("DELETE FROM puppies WHERE id=$1", [req.body.id]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    await deleteS3Keys(imageResult.rows.map((row) => row.imageid));
    res.redirect("/managePuppies");
  } else {
    res.redirect("/login");
  }
});

app.post("/deleteParent", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    const imageResult = await db.query(
      "SELECT imageid FROM parentimages WHERE parentid = $1",
      [req.body.parentid],
    );
    try {
      await db.query("BEGIN");
      await db.query("DELETE FROM parentimages WHERE parentid=$1", [
        req.body.parentid,
      ]);
      await db.query("DELETE FROM parents WHERE parentid=$1", [
        req.body.parentid,
      ]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    await deleteS3Keys(imageResult.rows.map((row) => row.imageid));
    res.redirect("/manageParents");
  } else {
    res.redirect("/login");
  }
});

app.post("/deleteBreed", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("DELETE FROM breeds WHERE breed = $1", [req.body.breedName]);
    res.redirect("/manageBreeds");
  } else {
    res.redirect("/login");
  }
});

app.post("/updatePuppy", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    const id = req.body.id;
    const name = req.body.puppyName;
    const breed = req.body.puppyBreed;
    const gender = req.body.genderSelect;
    const dob = req.body.dob;
    const mother = req.body.puppyMother;
    const father = req.body.puppyFather;
    const akcRegistrable = req.body.akcRegistrable;
    const price = req.body.price;
    const soldStatus = req.body.soldStatus;
    await db.query(
      "UPDATE puppies SET name = $2, breed = $3, gender = $4, dob = $5, mother = $6, father = $7, akcregistrable = $8, price = $9, sold = $10 WHERE id=$1",
      [
        id,
        name,
        breed,
        gender,
        dob,
        mother,
        father,
        akcRegistrable,
        price,
        soldStatus,
      ],
    );
    res.redirect("/managePuppies");
  } else {
    res.redirect("/login");
  }
});

app.post(
  "/addPuppyImages",
  requireAuth,
  requireSameOrigin,
  upload.array("puppyImageUpload"),
  requireCsrf,
  async (req, res) => {
    let optimizedFiles = [];
    let transactionStarted = false;

    try {
      const puppyId = Number(req.body.puppyId);
      if (!Number.isInteger(puppyId) || puppyId <= 0) {
        await cleanupLocalFiles(req.files);
        return res.status(400).send("Invalid puppy id");
      }

      optimizedFiles = await optimizeAndUploadImages(req.files);
      await db.query("BEGIN");
      transactionStarted = true;
      for (const file of optimizedFiles) {
        await db.query(
          "INSERT INTO puppyimages (imageid, puppyid) VALUES ($1, $2)",
          [file.key, puppyId],
        );
      }
      await db.query("COMMIT");
      transactionStarted = false;

      return res.redirect("/managePuppies");
    } catch (err) {
      if (transactionStarted) await db.query("ROLLBACK");
      await cleanupLocalFiles(req.files);
      await deleteS3Keys(optimizedFiles.map((file) => file.key)).catch(() =>
        undefined,
      );
      console.error(err);
      return res.status(500).send("Error uploading puppy images.");
    }
  },
);

app.post(
  "/addParentImages",
  requireAuth,
  requireSameOrigin,
  upload.array("parentImageUpload"),
  requireCsrf,
  async (req, res) => {
    let optimizedFiles = [];
    let transactionStarted = false;

    try {
      const parentId = Number(req.body.parentid);
      if (!Number.isInteger(parentId) || parentId <= 0) {
        await cleanupLocalFiles(req.files);
        return res.status(400).send("Invalid parent id");
      }

      optimizedFiles = await optimizeAndUploadImages(req.files);
      await db.query("BEGIN");
      transactionStarted = true;
      for (const file of optimizedFiles) {
        await db.query(
          "INSERT INTO parentimages (imageid, parentid) VALUES ($1, $2)",
          [file.key, parentId],
        );
      }
      await db.query("COMMIT");
      transactionStarted = false;
      return res.redirect("/manageParents");
    } catch (err) {
      if (transactionStarted) await db.query("ROLLBACK");
      await cleanupLocalFiles(req.files);
      await deleteS3Keys(optimizedFiles.map((file) => file.key)).catch(() =>
        undefined,
      );
      console.error(err);
      return res.status(500).send("Error uploading parent images.");
    }
  },
);

app.post("/updateParent", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    const parentid = req.body.parentid;
    const name = req.body.parentName;
    const breed = req.body.parentBreed;
    const gender = req.body.genderSelect;
    const dob = req.body.dob;
    const akcRegistered = req.body.akcRegistered;
    const championBloodline = req.body.championBloodline;
    const description = req.body.parentDescription;

    await db.query(
      "UPDATE parents SET name = $2, breed = $3, gender = $4, dob = $5, akcregistered = $6, description = $7, championbloodline = $8 WHERE parentid=$1",
      [
        parentid,
        name,
        breed,
        gender,
        dob,
        akcRegistered,
        description,
        championBloodline,
      ],
    );
    res.redirect("/manageParents");
  } else {
    res.redirect("/login");
  }
});

app.post("/submitNewBreed", requireAuth, requireCsrf, async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("INSERT INTO breeds VALUES ($1)", [req.body.breedName]);
    res.redirect("/manageBreeds");
  } else {
    res.redirect("/login");
  }
});

app.post(
  "/submitNewPuppy",
  requireAuth,
  requireSameOrigin,
  upload.array("puppyImageUpload"),
  requireCsrf,
  async (req, res) => {
    let optimizedFiles = [];
    let transactionStarted = false;

    try {
      const newPuppy = req.body;
      const akcRegistrable = newPuppy.akcRegistrable === "true";
      const price = newPuppy.price ? Number(newPuppy.price) : 0;
      optimizedFiles = await optimizeAndUploadImages(req.files);

      // Use a transaction so puppy + images either both succeed or both fail
      await db.query("BEGIN");
      transactionStarted = true;

      // Insert puppy and get its generated id back
      const insertResult = await db.query(
        `INSERT INTO puppies (name, breed, gender, dob, price, mother, father, akcRegistrable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
        [
          newPuppy.puppyName,
          newPuppy.puppyBreed,
          newPuppy.genderSelect,
          newPuppy.dob,
          price,
          newPuppy.puppyMother,
          newPuppy.puppyFather,
          akcRegistrable,
        ],
      );

      const puppyId = insertResult.rows[0].id;

      // Attach uploaded images directly to the new puppy id
      for (const file of optimizedFiles) {
        await db.query(
          "INSERT INTO puppyimages (imageid, puppyid) VALUES ($1, $2)",
          [file.key, puppyId],
        );
      }

      await db.query("COMMIT");
      transactionStarted = false;
      return res.redirect("/managePuppies");
    } catch (err) {
      if (transactionStarted) await db.query("ROLLBACK");
      await cleanupLocalFiles(req.files);
      await deleteS3Keys(optimizedFiles.map((file) => file.key)).catch(() =>
        undefined,
      );
      console.error(err);
      return res.status(500).send("Error creating puppy.");
    }
  },
);

app.post(
  "/submitNewParent",
  requireAuth,
  requireSameOrigin,
  upload.array("parentImageUpload"),
  requireCsrf,
  async (req, res) => {
    let optimizedFiles = [];
    let transactionStarted = false;

    try {
      const newParent = req.body;
      const akcRegistered = newParent.akcRegistered === "true";
      optimizedFiles = await optimizeAndUploadImages(req.files);

      await db.query("BEGIN");
      transactionStarted = true;

      // Insert parent and get generated parentid back
      const insertResult = await db.query(
        `INSERT INTO parents (name, breed, gender, dob, akcRegistered, description)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING parentid`,
        [
          newParent.parentName,
          newParent.parentBreed,
          newParent.genderSelect,
          newParent.dob,
          akcRegistered,
          newParent.descriptionTextBox,
        ],
      );

      const parentId = insertResult.rows[0].parentid;

      for (const file of optimizedFiles) {
        await db.query(
          "INSERT INTO parentimages (imageid, parentid) VALUES ($1, $2)",
          [file.key, parentId],
        );
      }

      await db.query("COMMIT");
      transactionStarted = false;
      return res.redirect("/manageParents");
    } catch (err) {
      if (transactionStarted) await db.query("ROLLBACK");
      await cleanupLocalFiles(req.files);
      await deleteS3Keys(optimizedFiles.map((file) => file.key)).catch(() =>
        undefined,
      );
      console.error(err);
      return res.status(500).send("Error creating parent.");
    }
  },
);

passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query(
        "SELECT id, username, password FROM users WHERE username = $1",
        [username],
      );

      if (result.rows.length === 0) {
        return cb(null, false, { message: "Invalid username" });
      }

      const user = result.rows[0];
      const storedHashedPassword = user.password;

      bcrypt.compare(password, storedHashedPassword, (err, valid) => {
        if (err) return cb(err);
        if (!valid) return cb(null, false, { message: "Invalid password" });
        return cb(null, user);
      });
    } catch (err) {
      return cb(err);
    }
  }),
);

passport.serializeUser((user, cb) => {
  cb(null, user.id);
});
passport.deserializeUser(async (userId, cb) => {
  try {
    const result = await db.query(
      "SELECT id, username FROM users WHERE id = $1",
      [userId],
    );
    return cb(null, result.rows[0] || false);
  } catch (error) {
    return cb(error);
  }
});

app.use(async (error, req, res, next) => {
  await cleanupLocalFiles(req.files);
  console.error(error);

  if (error instanceof multer.MulterError) {
    return res.status(400).send(`Upload rejected: ${error.message}`);
  }

  return res.status(500).send("An unexpected error occurred.");
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Listening @ ${port}`);
});
