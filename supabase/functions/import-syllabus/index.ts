import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Complete syllabus data parsed from the Excel
const syllabusData = [
  // Class 4
  { grade: 4, subject: "English – Literature", topics: ["Wake Up", "Neha's Alarm Clock", "Noses", "The Little Fir Tree", "Run!", "Nasruddin's Aim", "Why?", "Alice in Wonderland", "Don't Be Afraid of the Dark", "Helen Keller", "The Donkey", "The Milkman's Cow", "Hiawatha", "The Scholar's Mother Tongue", "A Watering Rhyme", "The Giving Tree", "Books", "Going to Buy a Book", "The Naughty Boy", "Pinocchio"] },
  { grade: 4, subject: "English – Grammar & Writing Skills", topics: ["Nouns", "Pronouns", "Verbs", "Adjectives", "Adverbs", "Prepositions", "Conjunctions", "Articles", "Opposites", "Tenses (Simple Present, Past, and Future)", "Gender", "Singular and Plural", "Punctuation", "Sentence Formation", "Paragraph Writing", "Picture Composition", "Informal Letter Writing", "Story Writing", "Reading Comprehension"] },
  { grade: 4, subject: "Mathematics", topics: ["Building with Bricks", "Long and Short", "A Trip to Bhopal", "Tick-Tick-Tick", "The Way The World Looks", "The Junk Seller", "Jugs and Mugs", "Carts and Wheels", "Halves and Quarters", "Play with Patterns", "Tables and Shares", "How Heavy? How Light?", "Fields and Fences", "Smart Charts"] },
  { grade: 4, subject: "Environmental Studies", topics: ["Going to School", "Ear to Ear", "A Day with Nandu", "The Story of Amrita", "Anita and the Honeybees", "Omana's Journey", "From the Window", "Reaching Grandmother's House", "Changing Families", "Hu Tu Tu, Hu Tu Tu", "The Valley of Flowers", "Changing Times", "A River's Tale", "Basva's Farm", "From Market to Home", "A Busy Month", "Nandita in Mumbai", "Too Much Water, Too Little Water", "Abdul in the Garden", "Eating Together", "Food and Fun", "The World in My Home", "Pochampalli", "Home and Abroad", "Spicy Riddles", "Defence Officer: Wahida", "Chuskit Goes to School"] },
  { grade: 4, subject: "Computer Science", topics: ["Computer – A Smart Machine", "Input and Output Devices", "Storage Devices", "Introduction to Paint", "More About Keyboard and Mouse", "Working with Word Processor", "Uses of Computers", "Internet Basics", "Computer Manners and Safety Rules"] },
  { grade: 4, subject: "General Knowledge", topics: ["Our Country India", "States and Capitals", "Festivals and Celebrations", "Famous People", "Plants and Animals", "Continents and Oceans", "Inventions and Discoveries", "Sports and Games", "Environment and Nature", "Solar System and Space"] },
  
  // Class 5
  { grade: 5, subject: "English – Literature", topics: ["Ice-cream Man", "Wonderful Waste!", "Teamwork", "Flying Together", "My Shadow", "Robinson Crusoe Discovers a Footprint", "Crying", "My Elder Brother", "The Lazy Frog", "Rip Van Winkle", "Class Discussion", "The Talkative Barber", "Topsy-Turvy Land", "Gulliver's Travels", "Nobody's Friend", "The Little Bully", "Sing a Song of People", "Malu Bhalu", "Who Will be Ningthou?"] },
  { grade: 5, subject: "English – Grammar", topics: ["Nouns", "Pronouns", "Adjectives", "Verbs", "Adverbs", "Prepositions", "Conjunctions", "Interjections", "Tenses (Present, Past, Future)", "Articles (A, An, The)", "Subject-Verb Agreement", "Vocabulary & Word Formation", "Antonyms & Synonyms", "Punctuation", "Sentence Types", "Direct and Indirect Speech", "Composition & Comprehension"] },
  { grade: 5, subject: "Mathematics", topics: ["The Fish Tale", "Shapes and Angles", "How Many Squares?", "Parts and Wholes", "Does It Look the Same?", "Be My Multiple, I'll Be Your Factor", "Can You See the Pattern?", "Mapping Your Way", "Boxes and Sketches", "Tenths and Hundredths", "Area and its Boundary", "Smart Charts", "Ways to Multiply and Divide", "How Big? How Heavy?"] },
  { grade: 5, subject: "EVS", topics: ["Super Senses", "A Snake Charmer's Story", "From Tasting to Digesting", "Mangoes Round the Year", "Seeds And Seeds", "Every Drop Counts", "Experiments With Water", "A Treat for Mosquitoes", "Up You Go", "Walls Tell Stories", "Sunita In Space", "What If It Finishes", "A Shelter So High", "When The Earth Shook", "Blow Hot, Blow Cold", "Whose Forests?", "Like Father, Like Daughter", "On the Move Again"] },
  
  // Class 6
  { grade: 6, subject: "English – Literature", topics: ["Who Did Patrick's Homework?", "How the Dog Found Himself a New Master!", "Taro's Reward", "An Indian – American Woman in Space: Kalpana Chawla", "A Different Kind of School", "Who I Am", "Fair Play", "A Game of Chance", "Desert Animals", "The Banyan Tree", "A Tale of Two Birds", "The Friendly Mongoose", "The Shepherd's Treasure", "The Old-Clock Shop", "Tansen", "The Monkey and the Crocodile", "The Wonder Called Sleep", "A Pact with the Sun", "What Happened to the Reptiles", "A Strange Wrestling Match"] },
  { grade: 6, subject: "English – Grammar & Writing Skills", topics: ["Parts of Speech", "Nouns", "Pronouns", "Adjectives", "Verbs", "Adverbs", "Prepositions", "Conjunctions", "Articles", "Tenses", "Subject-Verb Agreement", "Direct and Indirect Speech", "Punctuation", "Reading Comprehension", "Notice Writing", "Message Writing", "Paragraph Writing", "Letter Writing (Formal & Informal)", "Story Writing", "Diary Entry"] },
  { grade: 6, subject: "Mathematics", topics: ["Knowing Our Numbers", "Whole Numbers", "Playing with Numbers", "Basic Geometrical Ideas", "Understanding Elementary Shapes", "Integers", "Fractions", "Decimals", "Data Handling", "Mensuration", "Algebra", "Ratio and Proportion", "Symmetry", "Practical Geometry"] },
  { grade: 6, subject: "Science", topics: ["Food: Where Does It Come From?", "Components of Food", "Fibre to Fabric", "Sorting Materials into Groups", "Separation of Substances", "Changes Around Us", "Getting to Know Plants", "Body Movements", "The Living Organisms and Their Surroundings", "Motion and Measurement of Distances", "Light, Shadows and Reflections", "Electricity and Circuits", "Fun with Magnets", "Water", "Air Around Us", "Garbage In, Garbage Out"] },
  { grade: 6, subject: "History", topics: ["What, Where, How and When?", "From Hunting-Gathering to Growing Food", "In the Earliest Cities", "What Books and Burials Tell Us", "Kingdoms, Kings and an Early Republic", "New Questions and Ideas", "Ashoka, the Emperor Who Gave Up War", "Vital Villages, Thriving Towns", "Traders, Kings and Pilgrims", "New Empires and Kingdoms", "Buildings, Paintings and Books"] },
  { grade: 6, subject: "Geography", topics: ["The Earth in the Solar System", "Globe: Latitudes and Longitudes", "Motions of the Earth", "Maps", "Major Domains of the Earth", "Major Landforms of the Earth", "Our Country – India", "India: Climate, Vegetation and Wildlife"] },
  { grade: 6, subject: "Civics", topics: ["Understanding Diversity", "Diversity and Discrimination", "What is Government?", "Key Elements of a Democratic Government", "Panchayati Raj", "Rural Administration", "Urban Administration", "Rural Livelihoods", "Urban Livelihoods"] },
  
  // Class 7
  { grade: 7, subject: "English – Literature", topics: ["Three Questions", "A Gift of Chappals", "Gopal and the Hilsa Fish", "The Ashes That Made Trees Bloom", "Quality", "Expert Detectives", "The Invention of Vita-Wonk", "Fire: Friend and Foe", "A Bicycle in Good Repair", "The Story of Cricket", "The Tiny Teacher", "Bringing Up Kari", "The Desert", "The Cop and the Anthem", "Golu Grows a Nose", "I Want Something in a Cage", "Chandni", "The Bear Story", "A Tiger in the House", "An Alien Hand"] },
  { grade: 7, subject: "English – Grammar & Writing Skills", topics: ["Parts of Speech", "Tenses", "Modals", "Articles", "Determiners", "Prepositions", "Subject-Verb Concord", "Clauses and Phrases", "Active and Passive Voice", "Direct and Indirect Speech", "Punctuation", "Letter Writing (Formal & Informal)", "Notice Writing", "Paragraph Writing", "Diary Entry", "Story Writing", "Descriptive Paragraphs"] },
  { grade: 7, subject: "Mathematics", topics: ["Integers", "Fractions and Decimals", "Data Handling", "Simple Equations", "Lines and Angles", "The Triangle and Its Properties", "Congruence of Triangles", "Comparing Quantities", "Rational Numbers", "Practical Geometry", "Perimeter and Area", "Algebraic Expressions", "Exponents and Powers", "Symmetry", "Visualising Solid Shapes"] },
  { grade: 7, subject: "Science", topics: ["Nutrition in Plants", "Nutrition in Animals", "Fibre to Fabric", "Heat", "Acids, Bases and Salts", "Physical and Chemical Changes", "Weather, Climate and Adaptations of Animals", "Winds, Storms and Cyclones", "Soil", "Respiration in Organisms", "Transportation in Animals and Plants", "Reproduction in Plants", "Motion and Time", "Electric Current and its Effects", "Light", "Water – A Precious Resource", "Forests – Our Lifeline", "Wastewater Story"] },
  { grade: 7, subject: "History", topics: ["Tracing Changes Through a Thousand Years", "New Kings and Kingdoms", "The Delhi Sultans", "The Mughal Empire", "Rulers and Buildings", "Towns, Traders and Craftspersons", "Tribes, Nomads and Settled Communities", "Devotional Paths to the Divine", "The Making of Regional Cultures", "Eighteenth Century Political Formations"] },
  { grade: 7, subject: "Geography", topics: ["Environment", "Inside Our Earth", "Our Changing Earth", "Air", "Water", "Natural Vegetation and Wildlife", "Human Environment – Settlement, Transport and Communication", "Human–Environment Interactions – The Tropical and the Subtropical Region", "Life in the Deserts"] },
  { grade: 7, subject: "Civics", topics: ["On Equality", "Role of the Government in Health", "How the State Government Works", "Growing Up as Boys and Girls", "Women Change the World", "Understanding Media", "Understanding Advertising", "Markets Around Us", "A Shirt in the Market", "Struggles for Equality"] },
  
  // Class 8
  { grade: 8, subject: "English – Literature", topics: ["The Best Christmas Present in the World", "The Tsunami", "Glimpses of the Past", "Bepin Choudhury's Lapse of Memory", "The Summit Within", "This is Jody's Fawn", "A Visit to Cambridge", "A Short Monsoon Diary", "The Great Stone Face – I", "The Great Stone Face – II", "How the Camel Got His Hump", "Children at Work", "The Selfish Giant", "The Treasure Within", "Princess September", "The Fight", "The Open Window", "Jalebis", "The Comet – I", "The Comet – II"] },
  { grade: 8, subject: "English – Grammar & Composition", topics: ["Nouns", "Pronouns", "Verbs", "Adverbs", "Prepositions", "Conjunctions", "Interjections", "Tenses", "Direct & Indirect Speech", "Active & Passive Voice", "Order of Words and Clauses", "Phrases & Idioms", "Articles", "Vocabulary", "Notice Writing", "Letter Writing (Formal and Informal)", "Diary Entry", "Paragraph Writing", "Essay Writing", "Story Writing"] },
  { grade: 8, subject: "Mathematics", topics: ["Rational Numbers", "Linear Equations in One Variable", "Understanding Quadrilaterals", "Practical Geometry", "Data Handling", "Squares and Square Roots", "Cubes and Cube Roots", "Comparing Quantities", "Algebraic Expressions and Identities", "Visualising Solid Shapes", "Mensuration", "Exponents and Powers", "Direct and Inverse Proportions", "Factorisation", "Introduction to Graphs", "Playing with Numbers"] },
  { grade: 8, subject: "Science", topics: ["Crop Production and Management", "Microorganisms – Friend and Foe", "Synthetic Fibres and Plastics", "Materials – Metals and Non-Metals", "Coal and Petroleum", "Combustion and Flame", "Conservation of Plants and Animals", "Cell – Structure and Functions", "Reproduction in Animals", "Reaching the Age of Adolescence", "Force and Pressure", "Friction", "Sound", "Chemical Effects of Electric Current", "Some Natural Phenomena", "Light", "Stars and the Solar System", "Pollution of Air and Water"] },
  { grade: 8, subject: "Social Science – History", topics: ["How, When and Where", "From Trade to Territory", "Ruling the Countryside", "Tribals, Dikus and the Vision of a Golden Age", "When People Rebel – 1857 and After", "Colonialism and the City", "Weavers, Iron Smelters and Factory Owners", "Civilising the Native, Educating the Nation", "Women, Caste and Reform", "The Making of the National Movement (1870s–1947)", "India After Independence"] },
  { grade: 8, subject: "Social Science – Geography", topics: ["Resources", "Land, Soil, Water, Natural Vegetation and Wildlife Resources", "Mineral and Power Resources", "Agriculture", "Industries", "Human Resources"] },
  { grade: 8, subject: "Social Science – Civics", topics: ["The Indian Constitution", "Understanding Secularism", "Why Do We Need a Parliament", "Understanding Laws", "Judiciary", "Understanding Our Criminal Justice System", "Understanding Marginalisation", "Confronting Marginalisation", "Public Facilities", "Law and Social Justice"] },
  
  // Class 9
  { grade: 9, subject: "English – Literature", topics: ["The Fun They Had", "The Sound of Music", "The Little Girl", "A Truly Beautiful Mind", "The Snake and the Mirror", "My Childhood", "Packing", "Reach for the Top", "The Bond of Love", "Kathmandu", "If I Were You", "The Road Not Taken", "Wind", "Rain on the Roof", "The Lake Isle of Innisfree", "A Legend of the Northland", "No Men Are Foreign", "On Killing a Tree", "The Snake Trying", "A Slumber Did My Spirit Seal", "The Lost Child", "The Adventures of Toto", "Iswaran the Storyteller", "In the Kingdom of Fools", "The Happy Prince", "Weathering the Storm in Ersama", "The Last Leaf", "A House is Not a Home", "The Accidental Tourist", "The Beggar"] },
  { grade: 9, subject: "English – Grammar & Writing Skills", topics: ["Tenses", "Modals", "Subject–Verb Concord", "Determiners", "Reported Speech (Statements, Questions, Commands)", "Clauses", "Prepositions", "Articles", "Diary Entry", "Descriptive Paragraph (Person, Place, Event)", "Story Writing", "Letter Writing (Formal/Informal)", "Analytical Paragraph"] },
  { grade: 9, subject: "Mathematics", topics: ["Number Systems", "Polynomials", "Coordinate Geometry", "Linear Equations in Two Variables", "Introduction to Euclid's Geometry", "Lines and Angles", "Triangles", "Quadrilaterals", "Areas of Parallelograms and Triangles", "Circles", "Constructions", "Heron's Formula", "Surface Areas and Volumes", "Statistics", "Probability"] },
  { grade: 9, subject: "Science", topics: ["Matter in Our Surroundings", "Is Matter Around Us Pure", "Atoms and Molecules", "Structure of the Atom", "The Fundamental Unit of Life", "Tissues", "Diversity in Living Organisms", "Motion", "Force and Laws of Motion", "Gravitation", "Work and Energy", "Sound", "Why Do We Fall Ill", "Natural Resources", "Improvement in Food Resources"] },
  { grade: 9, subject: "History", topics: ["The French Revolution", "Socialism in Europe and the Russian Revolution", "Nazism and the Rise of Hitler", "Forest Society and Colonialism", "Pastoralists in the Modern World", "Peasants and Farmers", "History and Sport: The Story of Cricket", "Clothing: A Social History"] },
  { grade: 9, subject: "Geography", topics: ["India – Size and Location", "Physical Features of India", "Drainage", "Climate", "Natural Vegetation and Wildlife", "Population"] },
  { grade: 9, subject: "Political Science", topics: ["What is Democracy? Why Democracy?", "Constitutional Design", "Electoral Politics", "Working of Institutions", "Democratic Rights"] },
  { grade: 9, subject: "Economics", topics: ["The Story of Village Palampur", "People as Resource", "Poverty as a Challenge", "Food Security in India"] },
  
  // Class 10
  { grade: 10, subject: "English – Literature", topics: ["A Letter to God", "Nelson Mandela: Long Walk to Freedom", "Two Stories About Flying", "From the Diary of Anne Frank", "The Hundred Dresses I", "The Hundred Dresses II", "Glimpses of India", "Mijbil the Otter", "Madam Rides the Bus", "The Sermon at Benares", "The Proposal", "Dust of Snow", "Fire and Ice", "A Tiger in the Zoo", "How to Tell Wild Animals", "The Ball Poem", "Amanda!", "Animals", "The Trees", "Fog", "The Tale of Custard the Dragon", "For Anne Gregory"] },
  { grade: 10, subject: "English – Grammar & Writing Skills", topics: ["Tenses", "Modals", "Subject-Verb Concord", "Reported Speech", "Noun, Adverb & Relative Clauses", "Determiners", "Prepositions", "Formal Letter", "Analytical Paragraph", "Short Story"] },
  { grade: 10, subject: "Mathematics", topics: ["Real Numbers", "Polynomials", "Pair of Linear Equations in Two Variables", "Quadratic Equations", "Arithmetic Progressions", "Triangles", "Coordinate Geometry", "Introduction to Trigonometry", "Some Applications of Trigonometry", "Circles", "Constructions", "Areas Related to Circles", "Surface Areas & Volumes", "Statistics", "Probability"] },
  { grade: 10, subject: "Science", topics: ["Chemical Reactions and Equations", "Acids, Bases and Salts", "Metals and Non-Metals", "Carbon and its Compounds", "Periodic Classification of Elements", "Life Processes", "Control and Coordination", "How Do Organisms Reproduce?", "Heredity and Evolution", "Light – Reflection & Refraction", "Human Eye and the Colourful World", "Electricity", "Magnetic Effects of Electric Current", "Sources of Energy", "Our Environment", "Management of Natural Resources"] },
  { grade: 10, subject: "History", topics: ["The Rise of Nationalism in Europe", "Nationalist Movement in India", "The Making of a Global World", "The Age of Industrialisation", "Work, Life and Leisure", "Print Culture and the Modern World", "Novels, Society and History"] },
  { grade: 10, subject: "Geography", topics: ["Resources and Development", "Forest and Wildlife Resources", "Water Resources", "Agriculture", "Minerals and Energy Resources", "Manufacturing Industries", "Life Lines of National Economy"] },
  { grade: 10, subject: "Political Science / Civics", topics: ["Power Sharing", "Federalism", "Democracy and Diversity", "Gender, Religion and Caste", "Popular Struggles and Movements", "Political Parties", "Outcomes of Democracy", "Challenges to Democracy"] },
  { grade: 10, subject: "Economics", topics: ["Development", "Sectors of the Indian Economy", "Money and Credit", "Globalisation and the Indian Economy", "Consumer Rights"] },
  
  // Class 11
  { grade: 11, subject: "Accountancy", topics: ["Accounting concepts", "Objectives of accounting", "Basic accounting terms", "Accounting assumptions", "Accounting principles", "Double entry system", "Accounting equation", "Source documents", "Vouchers", "Journal entries", "Ledger posting", "Cash book", "Bank reconciliation statement", "Trial balance", "Errors and rectification", "Depreciation methods", "Provisions and reserves", "Capital and revenue items", "Financial statements", "Trading account", "Profit and loss account", "Balance sheet", "Adjustments in financial statements", "Bills of exchange", "Accounts from incomplete records", "Introduction to computers in accounting"] },
  { grade: 11, subject: "Business Studies", topics: ["Nature of business", "Objectives of business", "Risk in business", "Forms of business organisation", "Sole proprietorship", "Partnership", "Joint stock company", "Cooperative society", "Public sector enterprises", "Global enterprises", "Joint ventures", "Business services", "Banking services", "Insurance services", "Transportation services", "Warehousing services", "E-business", "Outsourcing", "Social responsibility", "Business ethics", "Sources of business finance", "Small business", "Internal trade", "Retail trade", "Wholesale trade", "International trade", "Export procedures", "Import procedures"] },
  { grade: 11, subject: "Economics (Statistics + Micro)", topics: ["Meaning of statistics", "Data collection", "Census method", "Sampling method", "Primary data", "Secondary data", "Classification of data", "Tabular presentation", "Diagrammatic presentation", "Graphical presentation", "Measures of central tendency", "Mean", "Median", "Mode", "Measures of dispersion", "Range", "Quartile deviation", "Mean deviation", "Standard deviation", "Lorenz curve", "Correlation", "Index numbers", "Introduction to microeconomics", "Central problems of an economy", "Production possibility curve", "Demand", "Law of demand", "Elasticity of demand", "Supply", "Law of supply", "Elasticity of supply", "Production function", "Short run production", "Long run production", "Costs of production", "Revenues", "Producer equilibrium", "Market equilibrium", "Effects of shifts in demand and supply"] },
  { grade: 11, subject: "English Core", topics: ["Reading comprehension", "Note making", "Summary writing", "Classified advertisements", "Posters", "Notices", "Formal letters", "Informal letters", "Speech writing", "Debate writing", "Grammar usage", "Tenses", "Modals", "Subject-verb agreement", "Clauses", "Editing tasks"] },
  { grade: 11, subject: "Mathematics", topics: ["Sets", "Relations", "Functions", "Complex numbers", "Quadratic equations", "Linear inequalities", "Permutations", "Combinations", "Binomial theorem", "Arithmetic progression", "Geometric progression", "Coordinate geometry", "Straight lines", "Conic sections", "Introduction to 3D geometry", "Limits", "Derivatives", "Statistics", "Probability"] },
  { grade: 11, subject: "Physics", topics: ["Need for measurement", "Units of measurement", "Systems of units", "SI units", "Fundamental and derived units", "Significant figures", "Dimensions of physical quantities", "Dimensional analysis and its applications", "Frame of reference", "Motion in a straight line", "Differentiation and integration for describing motion", "Uniform and non-uniform motion", "Instantaneous velocity", "Uniformly accelerated motion", "Velocity–time graph", "Position–time graph", "Projectile motion", "Uniform circular motion", "Intuitive concept of force", "Inertia", "Newton's first law", "Momentum", "Newton's second law", "Impulse", "Newton's third law", "Conservation of linear momentum and its applications", "Static friction", "Kinetic friction", "Laws of friction", "Rolling friction", "Lubrication", "Centripetal force", "Dynamics of circular motion"] },
  { grade: 11, subject: "Chemistry", topics: ["Importance and scope of chemistry", "Nature of matter", "Laws of chemical combination", "Dalton's atomic theory", "Atomic and molecular masses", "Mole concept and molar mass", "Percentage composition", "Empirical and molecular formula", "Chemical reactions", "Stoichiometry and related calculations", "Structure of atom", "Atomic number", "Isotopes and isobars", "Atomic models", "Concept of shells and subshells", "Dual nature of matter and light", "de Broglie relation", "Heisenberg uncertainty principle", "Orbitals", "Quantum numbers", "Shapes of orbitals", "Aufbau principle", "Pauli exclusion principle", "Hund's rule", "Electronic configurations", "Stability of orbitals", "Periodic classification of elements", "Periodic law", "Periodic table", "Periodic trends", "Nomenclature of elements", "Valence electrons", "Ionic bond", "Covalent bond", "Lewis structures", "VSEPR theory", "Molecular shapes", "Valence bond theory", "Hybridization", "Molecular orbital theory", "Hydrogen bonding", "Redox concepts", "Oxidation", "Reduction", "Redox reactions", "Oxidation numbers", "Balancing redox", "Applications of redox"] },
  { grade: 11, subject: "Biology", topics: ["Biodiversity", "Three domains of life", "Taxonomy", "Species and hierarchy", "Binomial nomenclature", "Five-kingdom classification", "Features of Monera", "Protista", "Fungi", "Lichens", "Viruses", "Viroids", "Plant kingdom", "Animal kingdom", "Morphology of flowering plants", "Anatomy of flowering plants", "Animal organization", "Cell theory", "Prokaryotic cells", "Eukaryotic cells", "Cell organelles", "Biomolecules", "Enzymes", "Cell cycle", "Mitosis", "Meiosis", "Photosynthesis", "Respiration", "Plant growth and development", "Plant hormones", "Breathing", "Respiration in humans", "Gas exchange", "Circulation", "Excretion", "Osmoregulation", "Locomotion", "Muscle contraction", "Skeleton and joints", "Neural control", "Nerve impulse", "Endocrine system", "Hormones", "Endocrine disorders"] },
  { grade: 11, subject: "Computer Science", topics: ["Computer organisation", "Hardware", "Software", "CPU", "Memory", "I/O devices", "System software", "Language translators", "Application software", "Operating system", "Boolean logic", "Logic gates", "Number systems", "Binary", "Octal", "Decimal", "Hexadecimal", "Python basics", "Operators", "Control flow", "Strings", "Lists", "Tuples", "Dictionaries", "Modules", "Math module", "Random module", "Statistics module", "Digital footprints", "Netiquette", "IPR", "Cybercrime", "Cyber safety", "Malware", "E-waste", "IT Act", "Technology and society"] },
  { grade: 11, subject: "Informatics Practices", topics: ["Evolution of computing devices", "Computer system components", "Input/output devices", "Memory", "Software types", "Python syntax", "Program structure", "Identifiers", "Data types", "Operators", "Expressions", "Input/Output", "Type conversion", "Debugging", "Control flow", "List methods", "Dictionary methods", "Database concepts", "Relational model", "SQL DDL", "SQL DML", "SQL SELECT", "Emerging technologies", "AI", "Machine Learning", "Robotics", "AR/VR", "Big Data", "IoT", "Cloud computing", "Blockchain", "Smart cities", "Data science"] },
  { grade: 11, subject: "Physical Education", topics: ["Concept of physical education", "Development of PE in India", "Trends in sports", "Career options in PE", "Khelo-India", "Fit-India", "Olympism", "Olympic values", "Ancient Olympics", "Modern Olympics", "Olympic symbols", "Olympic movement", "Yoga", "Ashtanga yoga", "Yogic kriyas", "Pranayama", "Stress management", "Disability types", "Adaptive PE", "Health", "Fitness", "Traditional sports", "Leadership", "First aid", "PRICE method"] },
  
  // Class 12
  { grade: 12, subject: "Accountancy", topics: ["Accounting for partnership firms", "Profit sharing ratios", "Admission of partner", "Retirement of partner", "Death of partner", "Goodwill valuation", "Reconstitution of partnership", "Dissolution of partnership", "Realisation account", "Issue of shares", "Forfeiture of shares", "Reissue of shares", "Issue of debentures", "Redemption of debentures", "Interest on debentures", "Financial statements of companies", "Statement of Profit and Loss", "Balance sheet (Schedule III)", "Cash flow statement", "Operating activities", "Investing activities", "Financing activities", "Ratio analysis", "Liquidity ratios", "Solvency ratios", "Turnover ratios", "Profitability ratios", "Comparative statements", "Common size statements"] },
  { grade: 12, subject: "Business Studies", topics: ["Nature and significance of management", "Principles of management", "Scientific management", "Fayol principles", "Business environment", "Planning process", "Organising process", "Delegation", "Decentralisation", "Staffing", "Recruitment", "Selection", "Training", "Development", "Directing", "Motivation", "Leadership", "Communication", "Controlling process", "Financial management", "Capital structure", "Fixed and working capital", "Financial markets", "Stock exchange", "Marketing management", "Product mix", "Price mix", "Place mix", "Promotion mix", "Consumer protection rights", "Redressal mechanisms"] },
  { grade: 12, subject: "Economics (Micro + Macro)", topics: ["Demand", "Elasticity of demand", "Production function", "Short-run production", "Long-run production", "Law of variable proportion", "Cost concepts", "Revenue concepts", "Producer equilibrium", "Supply", "Market equilibrium", "Effects of shifts in demand", "National income", "GDP", "GNP", "NDP", "NI", "Disposable income", "Methods of national income", "Money", "Banking", "Commercial banks", "Central bank functions", "Government budget", "Revenue expenditure", "Capital expenditure", "Fiscal deficit", "Balance of payments", "Exchange rates", "Foreign exchange market"] },
  { grade: 12, subject: "Mathematics", topics: ["Relations", "Functions", "Inverse trigonometric functions", "Matrices", "Determinants", "Adjoint", "Inverse of matrix", "Continuity", "Differentiability", "Derivatives", "Applications of derivatives", "Maxima", "Minima", "Increasing functions", "Decreasing functions", "Indefinite integrals", "Definite integrals", "Area under curves", "Differential equations", "Vector algebra", "Dot product", "Cross product", "3D geometry", "Direction cosines", "Equation of a plane", "Conditional probability", "Bayes' theorem"] },
  { grade: 12, subject: "Physics", topics: ["Electric charges", "Conductors and insulators", "Coulomb's law", "Superposition principle", "Electric field", "Electric field lines", "Electric dipole", "Electric flux", "Gauss's law", "Electric potential", "Potential difference", "Equipotential surfaces", "Electric potential energy", "Capacitance", "Combination of capacitors", "Energy stored in capacitor", "Drift velocity", "Mobility", "Ohm's law", "Resistivity", "Conductivity", "Series combination of resistors", "Parallel combination of resistors", "Kirchhoff's laws", "Wheatstone bridge", "Meter bridge", "Potentiometer", "Magnetic field", "Biot–Savart law", "Ampere's law", "Force on moving charge", "Force on current-carrying conductor", "Torque on current loop", "Moving coil galvanometer", "Magnetic materials", "Electromagnetic induction", "Faraday's law", "Lenz's law", "Induced EMF", "Eddy currents", "Alternating current", "Reactance", "Impedance", "LC oscillations", "Transformers", "Electromagnetic waves", "Displacement current", "Reflection", "Refraction", "Total internal reflection", "Lens formula", "Lens maker's formula", "Optical instruments", "Microscope", "Telescope", "Interference", "Young's double slit experiment", "Diffraction", "Polarisation", "Photoelectric effect", "Einstein's photoelectric equation", "de Broglie wavelength", "Atomic models", "Bohr model", "Nuclear fission", "Nuclear fusion", "Radioactivity", "Semiconductors", "Diodes", "Zener diode", "Transistors", "Logic gates", "NAND gate", "NOR gate", "Communication systems"] },
  { grade: 12, subject: "Chemistry", topics: ["Solutions", "Types of solutions", "Solubility", "Vapour pressure", "Raoult's law", "Colligative properties", "Electrochemistry", "Conductance", "Molar conductivity", "Kohlrausch's law", "Nernst equation", "Corrosion", "Chemical kinetics", "Rate of reaction", "Order of reaction", "Molecularity", "Activation energy", "Adsorption", "Catalysis", "Colloids", "Emulsion", "General principles of metallurgy", "Concentration of ores", "Roasting", "Calcination", "p-block elements", "d-block elements", "f-block elements", "Coordination compounds", "Ligands", "Isomerism", "Bonding in coordination compounds", "Haloalkanes", "Haloarenes", "Alcohols", "Phenols", "Ethers", "Aldehydes", "Ketones", "Carboxylic acids", "Amines", "Diazonium salts", "Carbohydrates", "Proteins", "Vitamins", "Nucleic acids", "Polymers", "Drugs", "Surfactants"] },
  { grade: 12, subject: "Biology", topics: ["Reproduction in organisms", "Sexual reproduction in flowering plants", "Pollination", "Fertilisation", "Seed formation", "Human reproduction", "Male reproductive system", "Female reproductive system", "Gametogenesis", "Menstrual cycle", "Pregnancy", "Parturition", "Reproductive health", "Mendelian inheritance", "Chromosomal theory", "Linkage", "Recombination", "DNA structure", "RNA structure", "Replication", "Transcription", "Translation", "Genetic code", "Gene expression", "Evolution", "Hardy–Weinberg principle", "Speciation", "Human evolution", "Immunity", "Vaccination", "AIDS", "Cancer", "Drugs and alcohol abuse", "Microbes in human welfare", "Fermentation", "Antibiotics", "Biogas", "Sewage treatment", "Biotechnology principles", "Restriction enzymes", "Vectors", "PCR", "DNA fingerprinting", "Transgenic organisms", "Ecosystem", "Energy flow", "Ecological pyramids", "Biodiversity", "Conservation", "Pollution", "Ozone depletion", "Global warming"] },
  { grade: 12, subject: "Computer Science", topics: ["Boolean logic", "Logic gates", "Minimization", "Number systems", "Python functions", "Recursion", "Python files", "CSV files", "OOP concepts", "Classes", "Objects", "Inheritance basics", "Stacks", "Queues", "Searching algorithms", "Sorting algorithms", "Databases", "SQL queries", "Tables", "Keys", "Joins", "Network types", "WWW", "Internet protocols", "Cyber safety", "Cyber laws"] },
  { grade: 12, subject: "Informatics Practices", topics: ["Python programming", "Pandas series", "Pandas dataframes", "Data cleaning", "Data visualization", "Line chart", "Bar chart", "Histogram", "Scatter plot", "Database concepts", "SQL SELECT", "SQL WHERE", "SQL GROUP BY", "SQL ORDER BY", "SQL INSERT", "SQL UPDATE", "SQL DELETE", "Joins", "Cyber safety", "Digital security", "Computer viruses", "Malware", "Data protection", "Internet services", "E-commerce", "Cloud computing"] },
  { grade: 12, subject: "Entrepreneurship", topics: ["Entrepreneurial opportunities", "Market identification", "Business planning", "Enterprise marketing", "Branding", "Packaging", "Pricing", "Sales strategy", "Customer relationship management", "Working capital", "Cash management", "Fixed and variable costs", "Cost of production", "Income statements", "Balance sheets", "Cash flow", "Resource mobilization", "Bootstrapping", "Angel funding", "Venture capital", "Intellectual property", "Patents", "Copyrights", "Trademarks"] },
  { grade: 12, subject: "Physical Education", topics: ["Sports planning", "Sports committees", "Tournaments", "Knock-out fixtures", "League fixtures", "Yoga", "Asanas", "Physical fitness", "Strength", "Endurance", "Flexibility", "Sports injuries", "Prevention of injuries", "First aid", "Rehabilitation", "Biomechanics", "Motion", "Force", "Levers", "Physiology of sports", "Cardiovascular system", "Muscular system", "Respiratory system", "Doping", "WADA rules", "Women in sports", "Balanced diet"] },
  { grade: 12, subject: "Psychology", topics: ["Intelligence", "Intelligence testing", "Aptitude", "Creativity", "Personality theories", "Trait approach", "Humanistic approach", "Behavioral approach", "Self and personality", "Stress", "Coping strategies", "Mental disorders", "Anxiety disorders", "Mood disorders", "Schizophrenia", "Therapeutic approaches", "Psychodynamic therapy", "Cognitive therapy", "Behavioral therapy", "Social influence", "Conformity", "Obedience", "Compliance", "Group processes", "Leadership", "Attitude formation", "Attitude change", "Prejudice", "Stereotypes", "Social cognition", "Attribution"] },
  { grade: 12, subject: "Biotechnology", topics: ["Biotechnology principles", "Biotechnology processes", "DNA structure", "Plasmids", "Vectors", "Restriction enzymes", "Ligases", "PCR", "Gel electrophoresis", "Cloning", "Recombinant DNA technology", "Gene cloning", "Gene therapy", "Stem cells", "Bioreactors", "Fermenters", "Downstream processing", "Bioprocess engineering", "Industrial biotechnology", "Enzyme production", "Microbial biotechnology", "Bioethics", "Biosafety", "GM crops", "Transgenic animals", "Environmental biotechnology"] },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Super-admin gate: this seeds the universal syllabus globally —
    // never an operation a school-level admin should be able to trigger.
    // Previously anonymous; anyone with the URL could re-seed the
    // syllabus and corrupt the universal data.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const jwt = authHeader.slice('Bearer '.length);
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );
    const { data: userData, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const { data: roleRows } = await anonClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .limit(10);
    const isSuperAdmin = (roleRows ?? []).some((r) => r.role === 'super_admin');
    if (!isSuperAdmin) {
      return new Response(
        JSON.stringify({ error: 'Super admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get grade levels
    const { data: gradeLevels } = await supabase
      .from('grade_levels')
      .select('id, grade_number');
    
    const gradeMap = new Map(gradeLevels?.map(g => [g.grade_number, g.id]) || []);

    // Get subjects
    const { data: subjects } = await supabase
      .from('universal_subjects')
      .select('id, name');
    
    const subjectMap = new Map(subjects?.map(s => [s.name, s.id]) || []);

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of syllabusData) {
      const gradeId = gradeMap.get(item.grade);
      const subjectId = subjectMap.get(item.subject);

      if (!gradeId) {
        errors.push(`Grade ${item.grade} not found`);
        continue;
      }
      if (!subjectId) {
        errors.push(`Subject "${item.subject}" not found`);
        continue;
      }

      for (let i = 0; i < item.topics.length; i++) {
        const topicName = item.topics[i].trim();
        if (!topicName) continue;

        const { error } = await supabase
          .from('syllabus_topics')
          .upsert({
            grade_level_id: gradeId,
            subject_id: subjectId,
            topic_name: topicName,
            display_order: i + 1,
          }, {
            onConflict: 'grade_level_id,subject_id,topic_name',
            ignoreDuplicates: true,
          });

        if (error) {
          if (error.code === '23505') {
            skipped++;
          } else {
            errors.push(`Error inserting "${topicName}": ${error.message}`);
          }
        } else {
          inserted++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      inserted,
      skipped,
      errors: errors.slice(0, 10), // Limit error messages
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Import error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
