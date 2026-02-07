import express from "express";
import { dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import env from "dotenv";
import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";

const envFile =
  process.env.NODE_ENV === "development" ? ".env.development" : ".env";
env.config({ path: envFile });

const app = express();
const port = process.env.SERVER_PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

const s3 = new S3Client();

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.BUCKET,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      cb(null, Date.now().toString() + file.originalname);
    },
  }),
  limits: {
    fileSize: 5242880,
    files: 50,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image uploads are allowed."));
  },
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(`${__dirname}/public`));

const db = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

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
  res.render("deposit.ejs");
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

app.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

app.post(
  "/login",
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

app.post("/deletePuppyImage", async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("DELETE FROM puppyimages WHERE imageid = $1", [
      req.body.photoDeleteID,
    ]);
    res.redirect("/managePuppies");
  } else {
    res.redirect("/login");
  }
});

app.post("/deleteParentImage", async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("DELETE FROM parentimages WHERE imageid = $1", [
      req.body.photoDeleteID,
    ]);
    res.redirect("/manageParents");
  } else {
    res.redirect("/login");
  }
});

app.post("/deletePuppy", async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("DELETE FROM puppyimages WHERE puppyid=$1", [req.body.id]);
    await db.query("DELETE FROM puppies WHERE id=$1", [req.body.id]);
    res.redirect("/managePuppies");
  } else {
    res.redirect("/login");
  }
});

app.post("/deleteParent", async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("DELETE FROM parentimages WHERE parentid=$1", [
      req.body.parentid,
    ]);
    await db.query("DELETE FROM parents WHERE parentid=$1", [
      req.body.parentid,
    ]);
    res.redirect("/manageParents");
  } else {
    res.redirect("/login");
  }
});

app.post("/deleteBreed", async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("DELETE FROM breeds WHERE breed = $1", [req.body.breedName]);
    res.redirect("/manageBreeds");
  } else {
    res.redirect("/login");
  }
});

app.post("/updatePuppy", async (req, res) => {
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
  upload.array("puppyImageUpload"),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/login");

    try {
      const puppyId = Number(req.body.puppyId);
      if (!Number.isInteger(puppyId) || puppyId <= 0) {
        return res.status(400).send("Invalid puppy id");
      }
      for (let i = 0; i < req.files.length; i++) {
        await db.query(
          "INSERT INTO puppyimages (imageid, puppyid) VALUES ($1, $2)",
          [req.files[i].key, puppyId],
        );
      }

      return res.redirect("/managePuppies");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Error uploading puppy images.");
    }
  },
);

app.post(
  "/addParentImages",
  upload.array("parentImageUpload"),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/login");

    try {
      const parentId = Number(req.body.parentid);
      if (!Number.isInteger(parentId) || parentId <= 0) {
        return res.status(400).send("Invalid parent id");
      }
      for (let i = 0; i < req.files.length; i++) {
        await db.query(
          "INSERT INTO parentimages (imageid, parentid) VALUES ($1, $2)",
          [req.files[i].key, parentId],
        );
      }
      return res.redirect("/manageParents");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Error uploading parent images.");
    }
  },
);

app.post("/updateParent", async (req, res) => {
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

app.post("/submitNewBreed", async (req, res) => {
  if (req.isAuthenticated()) {
    await db.query("INSERT INTO breeds VALUES ($1)", [req.body.breedName]);
    res.redirect("/manageBreeds");
  } else {
    res.redirect("/login");
  }
});

app.post(
  "/submitNewPuppy",
  upload.array("puppyImageUpload"),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/login");

    try {
      const newPuppy = req.body;
      const akcRegistrable = newPuppy.akcRegistrable === "true";
      const price = newPuppy.price ? Number(newPuppy.price) : 0;

      // Use a transaction so puppy + images either both succeed or both fail
      await db.query("BEGIN");

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
      for (let i = 0; i < req.files.length; i++) {
        await db.query(
          "INSERT INTO puppyimages (imageid, puppyid) VALUES ($1, $2)",
          [req.files[i].key, puppyId],
        );
      }

      await db.query("COMMIT");
      return res.redirect("/managePuppies");
    } catch (err) {
      await db.query("ROLLBACK");
      console.error(err);
      return res.status(500).send("Error creating puppy.");
    }
  },
);

app.post(
  "/submitNewParent",
  upload.array("parentImageUpload"),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/login");

    try {
      const newParent = req.body;
      const akcRegistered = newParent.akcRegistered === "true";

      await db.query("BEGIN");

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

      for (let i = 0; i < req.files.length; i++) {
        await db.query(
          "INSERT INTO parentimages (imageid, parentid) VALUES ($1, $2)",
          [req.files[i].key, parentId],
        );
      }

      await db.query("COMMIT");
      return res.redirect("/manageParents");
    } catch (err) {
      await db.query("ROLLBACK");
      console.error(err);
      return res.status(500).send("Error creating parent.");
    }
  },
);

passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE username = $1", [
        username,
      ]);

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
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, (req, res) => {
  console.log(`Listening @ ${port}`);
});
