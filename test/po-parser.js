(typeof describe === 'function') && describe("po-parser", function() {
    const should = require("should");
    const PoParser = require("../src/po-parser");

    it("TESTTESThello", function() {
        var parser = new PoParser();
        should(1).equal(1);
    });

})