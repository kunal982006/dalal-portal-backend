exports.checkEligibility = (req, res) => {
  try {
    const { netSalary, totalEmi } = req.body;

    if (typeof netSalary !== 'number' || typeof totalEmi !== 'number') {
      return res.status(400).json({ error: 'netSalary and totalEmi must be numbers' });
    }

    if (totalEmi * 2 >= netSalary) {
      return res.json({ status: "REJECTED", reason: "FOIR too high, capacity exhausted." });
    } else {
      return res.json({ status: "ELIGIBLE", reason: "Customer has sufficient capacity." });
    }
  } catch (error) {
    console.error('Error in checkEligibility:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
