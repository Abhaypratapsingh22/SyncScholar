/**
 * SyncScholar — Supplementary NCERT Ingestion Pipeline
 * 
 * Ingests:
 * 1. Classic NCERT Class 9 Science supplementary chunks for topics omitted from the NEP edition:
 *    - Matter in Our Surroundings: Evaporation causing cooling, latent heat of vaporization,
 *      factors affecting rate of evaporation (wind speed, temperature, surface area, humidity),
 *      density of ice vs water (open cage-like crystalline structure).
 *    - Gravitation: Universal law of gravitation, gravitational acceleration, free fall,
 *      and orbital weightlessness of astronauts.
 *    - Atoms and Molecules: The Mole Concept, Avogadro's constant (6.022 x 10^23),
 *      moles formula (n = m/M), and molecular mass calculations (HNO3, He, etc.).
 *    - Cell Organelles: Lysosomes as the "suicide bags" of the cell.
 * 2. NCERT Class 8 Science foundational prerequisite chunks:
 *    - Force & Pressure, Friction, Sound, Cell Structure, Metals & Non-metals,
 *      Microorganisms, Combustion & Flame, Crop Production, and Light.
 * 
 * Uses Google Gemini embedding API (gemini-embedding-001) at 768 dimensions.
 * Idempotently upserts into MongoDB Atlas `curriculum_chunks`.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'syncscholar';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'curriculum_chunks';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL_NAME = process.env.EMBEDDING_MODEL?.replace(/^models\//, '') || 'gemini-embedding-001';

if (!MONGODB_URI) {
  console.error('❌ Error: MONGODB_URI is not set in ingestion/.env');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY is not set in ingestion/.env');
  process.exit(1);
}

export const SUPPLEMENTARY_CHUNKS = [
  // ===========================================================================
  // CLASS 9 SUPPLEMENTARY CHUNKS (Matter in Our Surroundings, Gravitation, Mole Concept, Lysosomes)
  // ===========================================================================
  {
    chunk_id: 'ncert_sci_g9_ch01_supp_p08_c01',
    text: 'Evaporation is a surface phenomenon where particles from the surface of a liquid gain enough kinetic energy to overcome the intermolecular forces of attraction and convert into vapor at any temperature below its boiling point. Why does evaporation cause cooling? In an open vessel, the liquid keeps on evaporating. The particles of liquid absorb energy from the surroundings to regain the energy lost during evaporation. This absorption of energy from the surroundings makes the surroundings cold. For example, when you pour acetone (nail polish remover) or perfume on your palm, the particles absorb energy from your palm or surroundings and evaporate, causing your palm to feel cold. Similarly, after a hot sunny day, people sprinkle water on the roof or open ground because the large latent heat of vaporization of water helps to cool the hot surface.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 1,
      chapter_title: 'Matter in Our Surroundings',
      learning_objective_id: 'SCI-09-EVAP-01',
      difficulty_tier: 'foundational',
      page_number: 8,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=1-13'
    }
  },
  {
    chunk_id: 'ncert_sci_g9_ch01_supp_p09_c02',
    text: 'Factors Affecting the Rate of Evaporation: The rate of evaporation increases with: 1. An increase of surface area: Evaporation is a surface phenomenon. If the surface area is increased, the rate of evaporation increases. For example, while putting clothes for drying, we spread them out. 2. An increase of temperature: With the increase of temperature, more number of particles get enough kinetic energy to go into the vapor state. 3. A decrease in humidity: Humidity is the amount of water vapor present in air. The air around us cannot hold more than a definite amount of water vapor at a given temperature. If the amount of water in air is already high, the rate of evaporation decreases. 4. An increase in wind speed: It is a common observation that wet clothes dry faster on a windy day. With the increase in wind speed, the particles of water vapor move away with the wind, decreasing the amount of water vapor in the surrounding air. During summer, we wear cotton clothes because cotton is a good absorber of water; it absorbs sweat and exposes it to the atmosphere for easy evaporation, causing cooling.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 1,
      chapter_title: 'Matter in Our Surroundings',
      learning_objective_id: 'SCI-09-EVAP-02',
      difficulty_tier: 'intermediate',
      page_number: 9,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=1-13'
    }
  },
  {
    chunk_id: 'ncert_sci_g9_ch01_supp_p05_c03',
    text: 'Density and States of Matter: Density is defined as mass per unit volume (density = mass / volume). Solids generally have higher density than liquids because their constituent particles are closely packed with strong intermolecular forces. However, ice floats on water even though ice is a solid and water is a liquid. When liquid water freezes to form ice, the water molecules arrange themselves in an open, cage-like three-dimensional crystalline lattice held together by hydrogen bonds. This open cage structure traps empty spaces between molecules, meaning that for a given mass, ice occupies a larger volume than the same mass of liquid water. Consequently, the density of ice is lower than the density of liquid water, allowing ice to float on water.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 1,
      chapter_title: 'Matter in Our Surroundings',
      learning_objective_id: 'SCI-09-MATT-03',
      difficulty_tier: 'intermediate',
      page_number: 5,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=1-13'
    }
  },
  {
    chunk_id: 'ncert_sci_g9_ch10_supp_p131_c01',
    text: 'Gravitation and Universal Law of Gravitation: Sir Isaac Newton formulated the Universal Law of Gravitation: Every object in the universe attracts every other object with a force which is directly proportional to the product of their masses and inversely proportional to the square of the distance between them. The force acts along the line joining the centres of two objects. Mathematically, F = G * (M * m) / d^2, where G is the Universal Gravitational Constant (G = 6.673 x 10^-11 N m^2 kg^-2). The gravitational force of the Earth is called gravity, and produces uniform acceleration due to gravity, denoted by g, on all freely falling objects near Earth surface (g = 9.8 m/s^2). The value of g is independent of the mass of the falling body.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 10,
      chapter_title: 'Gravitation',
      learning_objective_id: 'SCI-09-GRAV-01',
      difficulty_tier: 'foundational',
      page_number: 131,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=10-13'
    }
  },
  {
    chunk_id: 'ncert_sci_g9_ch10_supp_p137_c02',
    text: 'Free Fall and Weightlessness: Whenever objects fall towards the earth under gravitational force alone, we say that the objects are in free fall. During free fall, all objects experience acceleration due to gravity g = 9.8 m/s^2. Weight is the force with which an object is attracted towards the Earth (W = m * g). What happens in space? Why do astronauts appear weightless in an orbiting spacecraft? Earth gravity still acts on astronauts and the spacecraft in orbit—in fact, at 400 km altitude, gravity is still about 90% as strong as on Earth surface. However, both the spacecraft and the astronauts are in a continuous state of free fall towards Earth as they travel along their orbital path. Because both fall together at the exact same rate, the floor of the spacecraft does not exert any upward normal reaction force on the astronauts. Since our sensation of weight comes from the supporting normal force, the absence of this reaction force creates the phenomenon of apparent weightlessness.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 10,
      chapter_title: 'Gravitation',
      learning_objective_id: 'SCI-09-GRAV-02',
      difficulty_tier: 'advanced',
      page_number: 137,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=10-13'
    }
  },
  {
    chunk_id: 'ncert_sci_g9_ch03_supp_p38_c01',
    text: 'The Mole Concept and Avogadro Constant: A mole is the amount of substance that contains as many elementary entities (atoms, molecules, or ions) as there are atoms in exactly 12 grams of Carbon-12. One mole of any substance is equal to 6.022 x 10^23 particles. This number is the Avogadro Constant or Avogadro Number, denoted by N_A. The mass of 1 mole of a substance in grams is called its molar mass. The molar mass of an atom is numerically equal to its atomic mass in atomic mass units (u) but expressed in grams (g/mol). For example, atomic mass of Helium (He) = 4 u; therefore, molar mass of Helium (M) = 4 g/mol. Formula to calculate number of moles (n): Number of moles (n) = Given mass (m) / Molar mass (M). For example, to find moles in 52 g of Helium: n = 52 g / 4 g/mol = 13 moles.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 3,
      chapter_title: 'Atoms and Molecules',
      learning_objective_id: 'SCI-09-MOLE-01',
      difficulty_tier: 'intermediate',
      page_number: 38,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=3-13'
    }
  },
  {
    chunk_id: 'ncert_sci_g9_ch03_supp_p39_c02',
    text: 'Molecular Mass and Formula Unit Mass: The molecular mass of a substance is the sum of the atomic masses of all the atoms in a molecule of the substance. It is expressed in atomic mass units (u). To calculate molecular mass, multiply the atomic mass of each element by its number of atoms in the chemical formula and sum the results. For example, for Nitric Acid (HNO3): Atomic mass of Hydrogen (H) = 1 u, Nitrogen (N) = 14 u, Oxygen (O) = 16 u. Molecular mass of HNO3 = (1 * 1) + (1 * 14) + (3 * 16) = 1 + 14 + 48 = 63 u. For Water (H2O): (2 * 1) + (1 * 16) = 18 u. For Carbon Dioxide (CO2): (1 * 12) + (2 * 16) = 44 u. For Calcium Hydroxide, Ca(OH)2: Atomic mass of Ca = 40 u, O = 16 u, H = 1 u. Formula mass = 40 + 2 * (16 + 1) = 40 + 34 = 74 u.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 3,
      chapter_title: 'Atoms and Molecules',
      learning_objective_id: 'SCI-09-MOLE-02',
      difficulty_tier: 'intermediate',
      page_number: 39,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=3-13'
    }
  },
  {
    chunk_id: 'ncert_sci_g9_ch02_supp_p15_c01',
    text: 'Lysosomes — The Clean-Up System and Suicide Bags of the Cell: Structurally, lysosomes are membrane-bound sacs filled with powerful digestive enzymes (hydrolytic enzymes). These enzymes are synthesized by the rough endoplasmic reticulum (RER). Lysosomes are a kind of waste disposal and clean-up system of the cell. They help to keep the cell clean by digesting any foreign material as well as worn-out cell organelles. Complex substances are broken down into simpler substances. During the disturbance in cellular metabolism, for example, when the cell gets damaged, lysosomes may burst and the digestive enzymes digest their own cell. Therefore, lysosomes are also famously known as the "suicide bags" of a cell.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 9,
      subject: 'Science',
      chapter_number: 2,
      chapter_title: 'Cell: The Building Block of Life',
      learning_objective_id: 'SCI-09-CELL-05',
      difficulty_tier: 'foundational',
      page_number: 15,
      source_url: 'https://ncert.nic.in/textbook.php?jesc1=2-13'
    }
  },

  // ===========================================================================
  // CLASS 8 PREREQUISITE FOUNDATIONAL CHUNKS (For Prerequisite Fallback < 50% Mastery)
  // ===========================================================================
  {
    chunk_id: 'ncert_sci_g8_ch11_p128_c01',
    text: 'Force — A Push or a Pull: In everyday life, actions like opening a door, kicking a football, lifting a school bag, or pushing a drawer involve a force. A force is a push or a pull upon an object resulting from its interaction with another object. Forces arise due to interaction between at least two objects. A force can change the state of motion of an object: it can cause a stationary object to move, change its speed (accelerate or decelerate), or change the direction of its motion. Furthermore, a force can change the shape of an object (e.g., pressing a ball of dough). The SI unit of force is the Newton (N).',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 11,
      chapter_title: 'Force and Pressure',
      learning_objective_id: 'SCI-08-FORC-01',
      difficulty_tier: 'foundational',
      page_number: 128,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc111.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch11_p134_c02',
    text: 'Pressure and Liquid/Gas Pressure: The force acting on a unit area of a surface is called pressure. Pressure = Force / Area on which it acts. For a given force, smaller the area of contact, larger the pressure. This is why a sharp nail easily pierces wood while a blunt one does not, and shoulder bags have broad straps so that the weight creates less pressure on shoulders. Liquids and gases also exert pressure on the walls of their container. The pressure exerted by water at the bottom of a container increases with the depth of the liquid column. The pressure exerted by air all around us is called atmospheric pressure.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 11,
      chapter_title: 'Force and Pressure',
      learning_objective_id: 'SCI-08-FORC-02',
      difficulty_tier: 'foundational',
      page_number: 134,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc111.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch12_p146_c01',
    text: 'Friction: When a moving ball rolls on the ground, it gradually slows down and finally comes to rest because of the force of friction. Friction is the force that opposes the relative motion between two surfaces in contact. Friction always acts in the direction opposite to the applied force. Friction is caused by the interlocking of microscopic irregularities on the two surfaces in contact. Rough surfaces have larger irregularities and produce greater friction. Types of friction include static friction (force required to overcome friction when an object starts moving from rest), sliding friction, and rolling friction. Rolling friction is always much smaller than sliding friction, which is why ball bearings are used in ceiling fans and bicycles.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 12,
      chapter_title: 'Friction',
      learning_objective_id: 'SCI-08-FRIC-01',
      difficulty_tier: 'foundational',
      page_number: 146,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc112.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch13_p158_c01',
    text: 'Sound Produced by Vibrating Objects: Sound is produced by vibrating bodies. Vibration is the rapid back-and-forth or to-and-fro motion of an object. In humans, sound is produced by the voice box or larynx located at the upper end of the windpipe; two vocal cords are stretched across the voice box leaving a narrow slit for the passage of air. Sound needs a material medium (solid, liquid, or gas) to travel; sound cannot travel through a vacuum because there are no particles to transmit mechanical waves. Sound travels fastest through solids, slower through liquids, and slowest through gases.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 13,
      chapter_title: 'Sound',
      learning_objective_id: 'SCI-08-SOUN-01',
      difficulty_tier: 'foundational',
      page_number: 158,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc113.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch13_p162_c02',
    text: 'Amplitude, Time Period, and Frequency of Vibration: The to-and-fro motion of an oscillating body is called oscillatory motion. The number of oscillations or vibrations per second is called the frequency of oscillation. Frequency is expressed in Hertz (Hz). A frequency of 1 Hz is one oscillation per second. Time period (T) is the time taken to complete one oscillation (T = 1 / Frequency). The maximum displacement of an oscillating body from its mean position is called its amplitude. The loudness of sound is proportional to the square of the amplitude of vibration; larger amplitude produces louder sound. Pitch or shrillness of sound is determined by frequency; higher frequency gives higher pitch.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 13,
      chapter_title: 'Sound',
      learning_objective_id: 'SCI-08-SOUN-02',
      difficulty_tier: 'intermediate',
      page_number: 162,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc113.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch08_p90_c01',
    text: 'Cell — Structure and Functions: Robert Hooke in 1665 observed slices of cork under a simple microscope and coined the term "cell" for the honeycomb-like compartments. Cells are the basic structural and functional units of all living organisms. Living organisms may be single-celled (unicellular, e.g., Amoeba, Paramecium) or multi-celled (multicellular). The basic parts of a cell are the cell membrane (plasma membrane), cytoplasm (jelly-like fluid between membrane and nucleus), and nucleus (the control centre containing chromosomes with genetic material DNA/genes). Plant cells have an additional rigid outer layer called the cell wall composed of cellulose, providing structural support and protection.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 8,
      chapter_title: 'Cell — Structure and Functions',
      learning_objective_id: 'SCI-08-CELL-01',
      difficulty_tier: 'foundational',
      page_number: 90,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc108.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch09_p100_c01',
    text: 'Reproduction in Animals: Reproduction is essential for the continuation of a species. Animals reproduce through two main modes: 1. Sexual reproduction: Reproduction resulting from the fusion of male and female gametes. In animals, male reproductive organs produce male gametes (sperm), while female reproductive organs produce female gametes (ova/eggs). The fusion of sperm and ovum is called fertilization, which produces a single-celled zygote that develops into an embryo. 2. Asexual reproduction: Reproduction involving only a single parent without gamete fusion, such as binary fission in Amoeba or budding in Hydra.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 9,
      chapter_title: 'Reproduction in Animals',
      learning_objective_id: 'SCI-08-REPR-01',
      difficulty_tier: 'foundational',
      page_number: 100,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc109.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch04_p44_c01',
    text: 'Materials: Metals and Non-Metals: Elements are broadly classified into metals and non-metals based on their physical and chemical properties. Physical properties of metals: metals are lustrous (shiny), malleable (can be beaten into thin sheets like aluminum foil), ductile (can be drawn into wires like copper), sonorous (produce ringing sound when struck), and good conductors of heat and electricity. Non-metals (e.g., carbon, sulfur, oxygen) are dull, brittle (break when hammered), and poor conductors of heat and electricity (except graphite, which conducts electricity). Chemically, metals react with oxygen to form basic oxides (e.g., magnesium oxide), while non-metals form acidic or neutral oxides (e.g., sulfur dioxide).',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 4,
      chapter_title: 'Materials: Metals and Non-Metals',
      learning_objective_id: 'SCI-08-META-01',
      difficulty_tier: 'foundational',
      page_number: 44,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc104.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch02_p17_c01',
    text: 'Microorganisms: Friend and Foe: Microorganisms are microscopic single-celled or multi-celled organisms found in air, water, soil, and living bodies. They are classified into four major groups: bacteria, fungi, protozoa, and some algae. Viruses are also microscopic but reproduce only inside host cells. Beneficial microorganisms: Lactobacillus bacteria promote the formation of curd from milk; yeast is used for commercial fermentation of sugars into alcohol and baking bread; antibiotics like penicillin are medicines produced from fungi and bacteria to kill disease-causing microbes. Harmful microorganisms (pathogens): cause diseases like cholera, typhoid, and tuberculosis. Food preservation methods include pasteurization, salting, sugaring, and chemical preservatives.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 2,
      chapter_title: 'Microorganisms: Friend and Foe',
      learning_objective_id: 'SCI-08-MICR-01',
      difficulty_tier: 'foundational',
      page_number: 17,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc102.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch06_p64_c01',
    text: 'Combustion and Flame: A chemical process in which a substance reacts with oxygen to give off heat is called combustion. The substance that undergoes combustion is called combustible or fuel. For combustion to occur, three conditions are essential: fuel, air (oxygen), and heat to raise the temperature of the fuel beyond its ignition temperature. Ignition temperature is the lowest temperature at which a substance catches fire. Substances with very low ignition temperatures that catch fire easily with a flame are called inflammable substances (e.g., petrol, alcohol, LPG). A candle flame has three distinct zones: innermost dark zone (unburnt wax vapors), middle luminous yellow zone (incomplete combustion), and outermost non-luminous blue zone (complete combustion, hottest part).',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 6,
      chapter_title: 'Combustion and Flame',
      learning_objective_id: 'SCI-08-COMB-01',
      difficulty_tier: 'foundational',
      page_number: 64,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc106.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch01_p01_c01',
    text: 'Crop Production and Management: When plants of the same kind are cultivated at one place on a large scale, it is called a crop. In India, crops are categorized into Kharif crops (sown in rainy season, June to September, e.g., paddy, maize, soyabean) and Rabi crops (grown in winter season, October to March, e.g., wheat, gram, pea, mustard). The primary agricultural practices include: 1. Preparation of soil (ploughing and leveling), 2. Sowing selected high-yield seeds, 3. Adding manure and fertilizers (manure is organic matter from decomposed waste; fertilizers are chemical salts supplying specific nutrients like nitrogen, phosphorus, potassium), 4. Irrigation (traditional and modern methods like sprinkler and drip irrigation), 5. Protection from weeds (weeding), 6. Harvesting, and 7. Storage in silos and granaries.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 1,
      chapter_title: 'Crop Production and Management',
      learning_objective_id: 'SCI-08-CROP-01',
      difficulty_tier: 'foundational',
      page_number: 1,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc101.pdf'
    }
  },
  {
    chunk_id: 'ncert_sci_g8_ch16_p199_c01',
    text: 'Light and Laws of Reflection: Light makes things visible to us when it reflects from an object and enters our eyes. Reflection of light follows two fundamental laws: 1. The angle of incidence (i) is always equal to the angle of reflection (r): angle i = angle r. 2. The incident ray, the normal at the point of incidence, and the reflected ray all lie in the same plane. When parallel rays of light fall on a smooth surface like a mirror, they reflect parallel to each other (regular reflection). When light falls on an irregular or rough surface, parallel rays are reflected in different directions (diffused or irregular reflection). The human eye has a transparent front part called cornea, an iris that controls the pupil size, and a crystalline lens that focuses inverted real images on the retina.',
    metadata: {
      source_curriculum: 'NCERT',
      grade_level: 8,
      subject: 'Science',
      chapter_number: 16,
      chapter_title: 'Light',
      learning_objective_id: 'SCI-08-LIGH-01',
      difficulty_tier: 'foundational',
      page_number: 199,
      source_url: 'https://ncert.nic.in/textbook/pdf/hesc116.pdf'
    }
  }
];

// Retry helper with exponential backoff for rate limits (HTTP 429)
async function generateEmbeddingWithRetry(model, text, maxRetries = 5) {
  let attempt = 0;
  let delay = 1000;

  while (attempt < maxRetries) {
    try {
      const response = await model.embedContent({
        content: { parts: [{ text }] },
        outputDimensionality: 768
      });
      return response.embedding.values;
    } catch (err) {
      attempt++;
      const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit && attempt < maxRetries) {
        console.warn(`⚠️ Rate limit (429) hit. Backing off for ${(delay / 1000).toFixed(1)}s (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to generate embedding after ${maxRetries} attempts.`);
}

async function runSupplementaryIngestion() {
  console.log('================================================================');
  console.log('🚀 SyncScholar — Supplementary NCERT Ingestion Pipeline');
  console.log('================================================================');
  console.log(`📌 Database: [${DATABASE_NAME}] | Collection: [${COLLECTION_NAME}]`);
  console.log(`🧠 Embedding Model: [${EMBEDDING_MODEL_NAME}] (outputDimensionality: 768)`);
  console.log(`📚 Total Supplementary Chunks to Ingest: ${SUPPLEMENTARY_CHUNKS.length}\n`);

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  const collection = db.collection(COLLECTION_NAME);

  try {
    let successCount = 0;

    for (let i = 0; i < SUPPLEMENTARY_CHUNKS.length; i++) {
      const chunk = SUPPLEMENTARY_CHUNKS[i];
      const { chunk_id, text, metadata } = chunk;

      process.stdout.write(`[${i + 1}/${SUPPLEMENTARY_CHUNKS.length}] Embedding & upserting "${chunk_id}" (Grade ${metadata.grade_level}: ${metadata.chapter_title})... `);

      const embeddingValues = await generateEmbeddingWithRetry(embeddingModel, text);

      if (!Array.isArray(embeddingValues) || embeddingValues.length !== 768) {
        throw new Error(`Invalid embedding vector size: ${embeddingValues?.length}`);
      }

      await collection.updateOne(
        { _id: chunk_id },
        {
          $set: {
            chunk_id,
            text,
            metadata,
            embedding: embeddingValues,
            updated_at: new Date()
          }
        },
        { upsert: true }
      );

      console.log('✅ Done');
      successCount++;

      // Small throttle pause to be gentle on Gemini embedding API rate limits
      await new Promise((res) => setTimeout(res, 350));
    }

    console.log(`\n🎉 Successfully ingested ${successCount}/${SUPPLEMENTARY_CHUNKS.length} supplementary chunks into MongoDB Atlas.`);
  } catch (err) {
    console.error('\n❌ Ingestion failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

runSupplementaryIngestion();

